import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event, func, select

from app.catalog.models import Product
from app.customers import service as customers
from app.errors import (
    ReturnAlreadyCancelledError,
    ReturnQtyExceedsSoldError,
    ReturnRequestConflictError,
    SaleHasReturnsError,
)
from app.inventory.models import StockBalance, StockMovement
from app.inventory.service import MovementIn, post_movements
from app.payments.schemas import PaymentCreate
from app.payments.service import post_payment
from app.returns import service as returns
from app.returns.models import SaleReturn
from app.sales import service as sales
from tests.factories import create_product
from tests.return_helpers import AT, invariant, make_sale, post_return, return_data


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/api/returns"),
        ("get", "/api/returns"),
        ("get", "/api/returns/1"),
        ("post", "/api/returns/1/cancel"),
    ],
)
def test_returns_require_login(client, method, path):
    assert getattr(client, method)(path).status_code == 401


def test_partial_second_return_and_sale_history(auth_client, return_case):
    case = return_case
    sale = make_sale(case)
    data = return_data(sale, 3, returned_at=AT + timedelta(days=1))
    first = auth_client.post("/api/returns", json=data.model_dump(mode="json"))
    assert first.status_code == 201, first.text
    result = first.json()
    assert result["total"] == result["debt_credit"] == 300
    assert result["refund_amount"] == 0 and result["refund_method"] is None
    assert result["sale"] == {"id": sale.id, "number": sale.number}
    assert result["customer"]["id"] == case.customer
    assert result["lines"][0]["unit_cost"] == 40
    second = post_return(case, sale, 2, "defective")
    detail = auth_client.get(f"/api/sales/{sale.id}").json()
    assert detail["lines"][0]["returned_qty"] == 5
    assert [item["id"] for item in detail["returns"]] == [result["id"], second.id]
    assert customers.current_debt(case.db, case.customer) == 500
    stock = case.db.scalar(select(StockBalance.qty).where(StockBalance.product_id == case.product))
    assert stock == 93
    movement = case.db.scalar(select(StockMovement).where(StockMovement.kind == "return"))
    assert (movement.qty, movement.unit_cost, movement.doc_type, movement.doc_id) == (
        3,
        40,
        "return",
        result["id"],
    )
    history = auth_client.get(f"/api/products/{case.product}/movements").json()
    assert (
        next(item for item in history["items"] if item["kind"] == "return")["doc_number"]
        == result["number"]
    )
    assert auth_client.get(f"/api/returns/{result['id']}").json() == result


def test_quantity_conflict_params_and_cancelled_return_excluded(return_case):
    case = return_case
    sale = make_sale(case, qty=3)
    post_return(case, sale, 2)
    with pytest.raises(ReturnQtyExceedsSoldError) as exc:
        post_return(case, sale, 2)
    assert exc.value.params == {"article": "RET-1", "sold": 3, "returned": 2, "requested": 2}
    case.db.rollback()


@pytest.mark.parametrize(
    "variant,kind",
    [
        ("foreign", "sale_line_not_in_sale"),
        ("duplicate", "duplicate_line"),
        ("cancelled", "sale_not_posted"),
        ("before", "returned_at_before_sale"),
        ("future", "date_in_future"),
    ],
)
def test_invalid_return(auth_client, return_case, variant, kind):
    case = return_case
    sale = make_sale(case)
    data = return_data(sale).model_dump(mode="json")
    if variant == "foreign":
        data["lines"][0]["sale_line_id"] = make_sale(case).lines[0].id
    elif variant == "duplicate":
        data["lines"] *= 2
    elif variant == "cancelled":
        sales.cancel_sale(case.db, sale.id, "Ошибка продажи", case.user)
    elif variant == "before":
        data["returned_at"] = (AT - timedelta(seconds=1)).isoformat()
    else:
        data["returned_at"] = (datetime.now(UTC) + timedelta(minutes=2)).isoformat()
    response = auth_client.post("/api/returns", json=data)
    assert response.status_code == (409 if variant == "cancelled" else 422), response.text
    error = response.json()
    assert error["code"] == (kind if variant in ("duplicate", "cancelled") else "validation_error")
    if variant not in ("duplicate", "cancelled"):
        assert error["errors"][0]["type"] == kind
    assert case.db.scalar(select(func.count()).select_from(SaleReturn)) == 0


@pytest.mark.parametrize(
    "paid,customer,qty,credit,refund,method",
    [
        (0, True, 2, 200, 0, None),
        (900, True, 2, 100, 100, "cash"),
        (1000, True, 2, 0, 200, "cash"),
        (1000, False, 2, 0, 200, "cash"),
    ],
)
def test_money_distribution(return_case, paid, customer, qty, credit, refund, method):
    case = return_case
    sale = make_sale(case, paid=paid, customer=customer)
    result = post_return(case, sale, qty)
    assert (result.debt_credit, result.refund_amount, result.refund_method) == (
        credit,
        refund,
        method,
    )
    if customer:
        invariant(case)


def test_negative_debt_and_card_refund(return_case):
    case = return_case
    old = make_sale(case)
    post_payment(
        case.db,
        PaymentCreate(request_id=uuid.uuid4(), customer_id=case.customer, amount=500),
        case.user,
    )
    sales.cancel_sale(case.db, old.id, "Ошибочная продажа", case.user)
    sale = make_sale(case, paid=1000)
    result = post_return(case, sale, 2, refund_method="card")
    assert (result.debt_credit, result.refund_amount, result.refund_method) == (0, 200, "card")
    assert customers.current_debt(case.db, case.customer) == -500
    invariant(case)


def test_refund_method_without_refund_and_zero_total(auth_client, return_case):
    case = return_case
    sale = make_sale(case)
    response = auth_client.post(
        "/api/returns", json=return_data(sale, refund_method="cash").model_dump(mode="json")
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["type"] == "refund_method_without_refund"
    zero = make_sale(case, price=0)
    result = post_return(case, zero)
    assert (result.total, result.debt_credit, result.refund_amount, result.refund_method) == (
        0,
        0,
        0,
        None,
    )
    assert sales.get_sale(case.db, zero.id).payment_status == "returned"


def test_return_cost_and_cancellation_formula(return_case):
    case = return_case
    sale = make_sale(case)
    post_movements(case.db, [MovementIn(case.product, 10, "receipt", unit_cost=140)], case.user)
    case.db.commit()
    balance = case.db.scalar(select(StockBalance).where(StockBalance.product_id == case.product))
    assert (balance.qty, balance.avg_cost) == (100, 50)
    document = post_return(case, sale, 5)
    assert (balance.qty, balance.avg_cost) == (105, 50)
    cancelled = returns.cancel_return(case.db, document.id, "Ошибка возврата", case.user)
    assert cancelled.status == "cancelled" and cancelled.cancelled_by_name
    assert (balance.qty, balance.avg_cost) == (100, 51)
    movements = case.db.scalars(
        select(StockMovement).where(StockMovement.doc_type == "return").order_by(StockMovement.id)
    ).all()
    assert [(m.kind, m.qty, m.unit_cost) for m in movements] == [
        ("return", 5, 40),
        ("return_cancel", -5, 40),
    ]
    assert sales.get_sale(case.db, sale.id).lines[0].returned_qty == 0
    assert customers.current_debt(case.db, case.customer) == 1000
    with pytest.raises(ReturnAlreadyCancelledError):
        returns.cancel_return(case.db, document.id, "Ещё раз", case.user)


def test_defect_without_movements_and_archived_product(return_case):
    case = return_case
    sale = make_sale(case)
    product = case.db.get(Product, case.product)
    product.is_archived = True
    case.db.commit()
    count = case.db.scalar(select(func.count()).select_from(StockMovement))
    document = post_return(case, sale, 3, "defective")
    returns.cancel_return(case.db, document.id, "Ошибка возврата", case.user)
    assert case.db.scalar(select(func.count()).select_from(StockMovement)) == count


def test_unknown_historical_cost_stays_null(return_case):
    case = return_case
    product = create_product(case.db)
    post_movements(case.db, [MovementIn(product.id, 10, "adjustment")], case.user)
    case.product = product.id
    sale = make_sale(case, qty=2)
    assert sale.lines[0].unit_cost is None
    post_movements(case.db, [MovementIn(product.id, 3, "receipt", unit_cost=75)], case.user)
    case.db.commit()
    document = post_return(case, sale)
    returns.cancel_return(case.db, document.id, "Ошибка возврата", case.user)
    balance = case.db.scalar(select(StockBalance).where(StockBalance.product_id == product.id))
    assert (balance.qty, balance.avg_cost) == (11, 75)
    assert case.db.scalars(
        select(StockMovement.unit_cost).where(StockMovement.doc_type == "return")
    ).all() == [None, None]


def test_return_cancel_blocked_is_atomic(auth_client, return_case):
    case = return_case
    sale = make_sale(case, qty=100)
    document = post_return(case, sale, 2)
    make_sale(case, qty=2)
    response = auth_client.post(
        f"/api/returns/{document.id}/cancel", json={"reason": "Ошибка возврата"}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "return_cancel_blocked"
    assert response.json()["params"]["items"] == [
        {"article": "RET-1", "available": 0, "requested": 2}
    ]
    assert returns.get_return(case.db, document.id).status == "posted"
    assert (
        case.db.scalar(
            select(func.count())
            .select_from(StockMovement)
            .where(StockMovement.kind == "return_cancel")
        )
        == 0
    )


def test_cancel_sale_requires_cancel_returns(return_case):
    case = return_case
    sale = make_sale(case)
    document = post_return(case, sale, 2)
    with pytest.raises(SaleHasReturnsError):
        sales.cancel_sale(case.db, sale.id, "Ошибка продажи", case.user)
    returns.cancel_return(case.db, document.id, "Ошибка возврата", case.user)
    # Cancelled returns no longer consume the returned quantity.
    replacement = post_return(case, sale, 10)
    returns.cancel_return(case.db, replacement.id, "Ошибка возврата", case.user)
    result = sales.cancel_sale(case.db, sale.id, "Ошибка продажи", case.user)
    assert result.outstanding is None and result.payment_status is None


def test_replay_and_optional_fields(auth_client, return_case):
    case = return_case
    sale = make_sale(case, paid=1000)
    data = return_data(
        sale, 2, note="  заметка  ", refund_method="card", returned_at=AT + timedelta(days=1)
    )
    first, created = returns.post_return(case.db, data, case.user)
    assert created
    assert auth_client.post("/api/returns", json=data.model_dump(mode="json")).status_code == 200
    optional = data.model_copy(update={"returned_at": None, "refund_method": None})
    again, created = returns.post_return(case.db, optional, case.user)
    assert not created and again == first
    equivalent = data.model_copy(
        update={"returned_at": datetime.fromisoformat("2026-01-11T15:00:00+05:00")}
    )
    assert returns.post_return(case.db, equivalent, case.user)[0] == first
    returns.cancel_return(case.db, first.id, "Ошибка возврата", case.user)
    sales.cancel_sale(case.db, sale.id, "Ошибка продажи", case.user)
    assert returns.post_return(case.db, data, case.user)[0].status == "cancelled"


@pytest.mark.parametrize(
    "field,value",
    [
        ("note", "другая"),
        ("refund_method", "cash"),
        ("returned_at", AT + timedelta(days=2)),
        ("sale_id", 999999),
    ],
)
def test_replay_conflicts(return_case, field, value):
    case = return_case
    sale = make_sale(case, paid=1000)
    data = return_data(sale, 2, refund_method="card", returned_at=AT + timedelta(days=1))
    returns.post_return(case.db, data, case.user)
    with pytest.raises(ReturnRequestConflictError):
        returns.post_return(case.db, data.model_copy(update={field: value}), case.user)


@pytest.mark.parametrize(
    "field,value", [("qty", 3), ("condition", "defective"), ("sale_line_id", 999999)]
)
def test_replay_line_conflicts(return_case, field, value):
    case = return_case
    sale = make_sale(case)
    data = return_data(sale, 2)
    returns.post_return(case.db, data, case.user)
    data.lines[0] = data.lines[0].model_copy(update={field: value})
    with pytest.raises(ReturnRequestConflictError):
        returns.post_return(case.db, data, case.user)


def test_own_return_credit_before_fifo(return_case):
    case = return_case
    a = make_sale(case, qty=5, price=100_000)
    b = make_sale(case, qty=10, price=100_000, at=AT + timedelta(days=1))
    document = post_return(case, b, 10)
    assert document.debt_credit == 1_000_000
    items = invariant(case)
    assert (items[a.id].outstanding, items[a.id].payment_status) == (500_000, "unpaid")
    assert (items[b.id].outstanding, items[b.id].payment_status) == (0, "returned")


def test_partial_return_reduces_own_invoice(return_case):
    case = return_case
    a = make_sale(case, qty=5)
    b = make_sale(case, qty=10, paid=200, at=AT + timedelta(days=1))
    post_return(case, b, 3)
    items = invariant(case)
    assert items[a.id].outstanding == 500
    assert (items[b.id].outstanding, items[b.id].payment_status) == (500, "partial")


def test_paid_invoice_return_credit_goes_to_pool(return_case):
    case = return_case
    a = make_sale(case, qty=5)
    b = make_sale(case, qty=10, paid=1000, at=AT + timedelta(days=1))
    result = post_return(case, b, 10)
    assert (result.debt_credit, result.refund_amount) == (500, 500)
    items = invariant(case)
    assert items[a.id].payment_status == "paid"
    assert items[b.id].payment_status == "returned"


def test_fifo_backdated_payments_and_filters(auth_client, return_case):
    case = return_case
    a = make_sale(case, qty=5)
    b = make_sale(case, qty=10, at=AT)
    c = make_sale(case, qty=2, at=AT + timedelta(days=1))
    post_payment(
        case.db,
        PaymentCreate(
            request_id=uuid.uuid4(),
            customer_id=case.customer,
            amount=700,
            paid_at=AT - timedelta(days=1),
        ),
        case.user,
    )
    post_return(case, c, 2)
    items = invariant(case)
    assert items[a.id].payment_status == "paid"
    assert (items[b.id].outstanding, items[b.id].payment_status) == (800, "partial")
    assert items[c.id].payment_status == "returned"
    for status, ids in [("open", [b.id]), ("partial", [b.id]), ("unpaid", [])]:
        page = auth_client.get("/api/sales", params={"payment_status": status}).json()
        assert [item["id"] for item in page["items"]] == ids
        assert page["total"] == len(ids)
        assert page["sum_posted"] == (1000 if ids else 0)
    page = auth_client.get("/api/sales", params={"date_from": "2026-01-11", "limit": 1}).json()
    assert page["items"][0]["payment_status"] == "returned"


def test_list_and_ledger_dates_pagination_and_queries(auth_client, return_case):
    case = return_case
    sale = make_sale(case)
    a = post_return(case, sale, 2, returned_at=datetime.fromisoformat("2026-01-11T00:00:00+05:00"))
    b = post_return(case, sale, 1, returned_at=datetime.fromisoformat("2026-01-12T00:00:00+05:00"))
    c = post_return(case, sale, 1, returned_at=AT + timedelta(days=3))
    returns.cancel_return(case.db, c.id, "Ошибка возврата", case.user)
    page = auth_client.get(
        "/api/returns",
        params={
            "sale_id": sale.id,
            "customer_id": case.customer,
            "from": "2026-01-11",
            "to": "2026-01-12",
            "limit": 1,
            "offset": 1,
        },
    ).json()
    assert (page["total"], page["sum_posted"]) == (2, 300)
    assert page["items"][0]["id"] == a.id and "lines" not in page["items"][0]
    assert auth_client.get("/api/returns", params={"status": "cancelled"}).json()["sum_posted"] == 0
    ledger = customers.customer_ledger(case.db, case.customer, 1, 1)
    assert ledger.total == 3
    assert ledger.items[0].kind == "return"
    assert (ledger.items[0].amount, ledger.items[0].debt_change, ledger.items[0].debt_after) == (
        200,
        -200,
        800,
    )
    assert ledger.items[0].refund_amount == 0 and ledger.items[0].refund_method is None
    for path in [f"/api/returns/{a.id}", f"/api/returns/{b.id}"]:
        assert auth_client.get(path).status_code == 200
    assert customers.get_customer(case.db, case.customer).debt == 700
    assert customers.search_customers(case.db, None, 50, 0).items[0].debt == 700
    assert customers.recent_customers(case.db, 6)[0].debt == 700
    assert customers.list_debts(case.db, 50, 0).total_debt == 700
    statements = []
    conn = case.db.connection()

    def record(*args):
        statements.append(args[2])

    event.listen(conn, "before_cursor_execute", record)
    try:
        returns.list_returns(case.db, None, None, None, None, None, 50, 0)
        assert len(statements) == 2
        statements.clear()
        sales.list_sales(case.db, None, None, None, None, 50, 0, "open")
        assert len(statements) == 2
    finally:
        event.remove(conn, "before_cursor_execute", record)


def test_missing_return_and_sale(auth_client):
    assert auth_client.get("/api/returns/999999").json()["code"] == "return_not_found"
    assert (
        auth_client.post("/api/returns/999999/cancel", json={"reason": "Ошибка"}).json()["code"]
        == "return_not_found"
    )
    data = {
        "request_id": str(uuid.uuid4()),
        "sale_id": 999999,
        "lines": [{"sale_line_id": 1, "qty": 1, "condition": "good"}],
    }
    assert auth_client.post("/api/returns", json=data).json()["code"] == "sale_not_found"


def test_return_numbers_reuse_after_failure(auth_client, return_case, monkeypatch):
    case = return_case
    sale = make_sale(case)
    first = post_return(case, sale)

    def fail(*args):
        from app.errors import InsufficientStockError

        raise InsufficientStockError("Сбой проведения")

    with monkeypatch.context() as patch:
        patch.setattr(returns, "post_movements", fail)
        response = auth_client.post("/api/returns", json=return_data(sale).model_dump(mode="json"))
        assert response.status_code == 409
    second = post_return(case, sale)
    assert second.number == first.number + 1


def test_integrity_error_replay_rolls_back_number(return_case, monkeypatch):
    case = return_case
    sale = make_sale(case)
    data = return_data(sale)
    first = returns.post_return(case.db, data, case.user)[0]
    actual = returns._existing_return
    calls = 0

    def stale_read(db, payload):
        nonlocal calls
        calls += 1
        return None if calls <= 2 else actual(db, payload)

    with monkeypatch.context() as patch:
        patch.setattr(returns, "_existing_return", stale_read)
        replay, created = returns.post_return(case.db, data, case.user)
    assert not created and replay == first
    assert calls == 3
    assert post_return(case, sale).number == first.number + 1


def test_replay_after_debt_changes_does_not_reallocate(return_case):
    case = return_case
    sale = make_sale(case)
    data = return_data(sale, 2)
    first = returns.post_return(case.db, data, case.user)[0]
    post_payment(
        case.db,
        PaymentCreate(request_id=uuid.uuid4(), customer_id=case.customer, amount=800),
        case.user,
    )
    again, created = returns.post_return(case.db, data, case.user)
    assert not created and again == first
    assert again.debt_credit == 200 and again.refund_amount == 0
    invariant(case)


def test_fifo_cancellations_and_guest_status(return_case):
    from app.payments.service import cancel_payment

    case = return_case
    a = make_sale(case, qty=5)
    b = make_sale(case, qty=10, at=AT + timedelta(days=1))
    payment = post_payment(
        case.db,
        PaymentCreate(request_id=uuid.uuid4(), customer_id=case.customer, amount=700),
        case.user,
    )[0]
    document = post_return(case, b, 10)
    items = invariant(case)
    assert items[a.id].payment_status == "paid" and items[b.id].payment_status == "returned"
    returns.cancel_return(case.db, document.id, "Ошибка возврата", case.user)
    assert invariant(case)[b.id].outstanding == 800
    cancel_payment(case.db, payment.id, "Ошибка оплаты", case.user)
    assert invariant(case)[a.id].outstanding == 500
    sales.cancel_sale(case.db, a.id, "Ошибка продажи", case.user)
    assert invariant(case)[b.id].outstanding == 1000
    guest = make_sale(case, qty=1, customer=False, paid=100)
    assert guest.payment_status == "paid"
    post_return(case, guest)
    assert sales.get_sale(case.db, guest.id).payment_status == "returned"


@pytest.mark.parametrize(
    "line",
    [
        {"sale_line_id": 1, "qty": 0, "condition": "good"},
        {"sale_line_id": 1, "qty": True, "condition": "good"},
        {"sale_line_id": 1, "qty": 1.5, "condition": "good"},
        {"sale_line_id": 1, "qty": 1, "condition": "other"},
        {"sale_line_id": 1, "qty": 1, "condition": "good", "unit_price": 100},
    ],
)
def test_return_request_validation(auth_client, line):
    data = {"request_id": str(uuid.uuid4()), "sale_id": 1, "lines": [line]}
    response = auth_client.post("/api/returns", json=data)
    assert response.status_code == 422 and response.json()["code"] == "validation_error"


def test_return_line_order_replay_and_multiple_line_refund(return_case):
    from app.reports.service import summary
    from app.returns.schemas import ReturnCreate, ReturnLineIn
    from app.sales.schemas import SaleCreate, SaleLineIn

    case = return_case
    second = create_product(case.db, sale_price=200)
    post_movements(case.db, [MovementIn(second.id, 10, "receipt", unit_cost=80)], case.user)
    sale = sales.post_sale(
        case.db,
        SaleCreate(
            request_id=uuid.uuid4(),
            customer_id=case.customer,
            sold_at=AT,
            lines=[
                SaleLineIn(product_id=case.product, qty=2, unit_price=100),
                SaleLineIn(product_id=second.id, qty=2, unit_price=second.sale_price),
            ],
        ),
        case.user,
    )[0]
    data = ReturnCreate(
        request_id=uuid.uuid4(),
        sale_id=sale.id,
        returned_at=AT + timedelta(days=1),
        lines=[
            ReturnLineIn(sale_line_id=line.id, qty=line.qty, condition="good")
            for line in sale.lines
        ],
    )
    first = returns.post_return(case.db, data, case.user)[0]
    assert first.refund_amount == 600
    data.lines.reverse()
    assert returns.post_return(case.db, data, case.user) == (first, False)
    result = summary(case.db, AT.date(), (AT + timedelta(days=1)).date())
    assert result.returns_total == 600 and result.returns_count == 1
    assert result.received.total == 0 and result.revenue == result.profit == 0

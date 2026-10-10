import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.customers.service import current_debt, fifo_debt_source
from app.debt_adjustments.models import CustomerDebtAdjustment
from app.debt_adjustments.schemas import DebtAdjustmentCreate
from app.debt_adjustments.service import cancel_debt_adjustment, post_debt_adjustment
from app.numbering import DocumentCounter, next_number
from app.payments.schemas import PaymentCreate
from app.payments.service import post_payment
from app.returns.service import cancel_return, post_return
from app.sales.service import cancel_sale, get_sale, list_sales
from tests.factories import create_customer
from tests.return_helpers import AT, make_sale, return_data

PATH = "/api/debt-adjustments"


def adjust(case, amount, **changes):
    return post_debt_adjustment(
        case.db,
        DebtAdjustmentCreate(
            request_id=changes.pop("request_id", uuid.uuid4()),
            customer_id=case.customer,
            amount=amount,
            reason=changes.pop("reason", "Opening debt"),
            **changes,
        ),
        case.user,
    )[0]


def pay(case, amount):
    return post_payment(
        case.db,
        PaymentCreate(
            request_id=uuid.uuid4(),
            customer_id=case.customer,
            amount=amount,
        ),
        case.user,
    )[0]


def invariant(case):
    source = fifo_debt_source()
    positions = case.db.execute(select(source).where(source.c.customer_id == case.customer)).all()
    assert sum(row.outstanding for row in positions) == max(current_debt(case.db, case.customer), 0)
    invoices = list_sales(case.db, None, None, case.customer, "posted", 200, 0).items
    for invoice in invoices:
        row = next(row for row in positions if row.kind == "sale" and row.id == invoice.id)
        detail = get_sale(case.db, invoice.id)
        assert row.outstanding == invoice.outstanding == detail.outstanding
        assert invoice.payment_status == detail.payment_status
    return {(row.kind, row.id): row.outstanding for row in positions}


def post(client, customer_id, amount, **changes):
    return client.post(
        PATH,
        json={
            "request_id": str(uuid.uuid4()),
            "customer_id": customer_id,
            "amount": amount,
            "reason": "  Бастапқы қалдық  ",
            **changes,
        },
    )


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", PATH),
        ("post", PATH),
        ("get", PATH + "/1"),
        ("post", PATH + "/1/cancel"),
    ],
)
def test_routes_require_login(client, method, path):
    assert client.request(method, path, json={}).status_code == 401


def test_lifecycle_and_all_debt_consumers(auth_client, return_case):
    case = return_case
    first = post(auth_client, case.customer, 5_000_000)
    assert first.status_code == 201, first.text
    document = first.json()
    assert document["reason"] == "Бастапқы қалдық"
    assert document["customer"]["id"] == case.customer
    assert document["created_by_name"] and document["created_at"] and document["adjusted_at"]
    assert auth_client.get(f"{PATH}/{document['id']}").json() == document
    customer = auth_client.get(f"/api/customers/{case.customer}").json()
    assert customer["debt"] == current_debt(case.db, case.customer) == 5_000_000
    for url in ("/api/customers", "/api/customers?q=" + customer["name"], "/api/customers/debts"):
        data = auth_client.get(url).json()
        assert (
            next(item for item in data["items"] if item["id"] == case.customer)["debt"] == 5_000_000
        )
    assert (
        next(
            item
            for item in auth_client.get("/api/customers/recent").json()
            if item["id"] == case.customer
        )["debt"]
        == 5_000_000
    )
    debts = auth_client.get("/api/customers/debts").json()
    assert debts["total_debt"] == 5_000_000 and debts["debtors_count"] == 1
    assert post(auth_client, case.customer, -1_000_000).status_code == 201
    assert current_debt(case.db, case.customer) == 4_000_000
    assert post(auth_client, case.customer, -4_000_001).json()["params"] == {
        "debt": 4_000_000,
        "amount": -4_000_001,
    }
    assert current_debt(case.db, case.customer) == 4_000_000
    assert post(auth_client, case.customer, -4_000_000).status_code == 201
    assert current_debt(case.db, case.customer) == 0
    assert post(auth_client, case.customer, -1).json()["code"] == "debt_adjustment_exceeds_debt"
    response = auth_client.post(
        f"{PATH}/{document['id']}/cancel", json={"reason": "Қате енгізілді"}
    )
    assert response.status_code == 200
    cancelled = response.json()
    assert cancelled["status"] == "cancelled" and cancelled["cancelled_at"]
    assert cancelled["cancelled_by_name"] and cancelled["cancel_reason"] == "Қате енгізілді"
    assert current_debt(case.db, case.customer) == -5_000_000
    assert auth_client.get("/api/customers/debts").json()["total_debt"] == 0
    assert (
        auth_client.post(f"{PATH}/{document['id']}/cancel", json={"reason": "Ошибка"}).json()[
            "code"
        ]
        == "debt_adjustment_already_cancelled"
    )
    assert post(auth_client, case.customer, 1).status_code == 201
    assert post(auth_client, case.customer, -1).status_code == 409


@pytest.mark.parametrize(
    "change",
    [
        {"amount": 101},
        {"customer_id": 9223372036854775807},
        {"reason": "Different reason"},
        {"adjusted_at": "2026-01-02T05:00:00Z"},
    ],
)
def test_replay_normalized_reason_timestamp_conflict_and_cancelled(
    auth_client, return_case, change
):
    payload = {
        "request_id": str(uuid.uuid4()),
        "customer_id": return_case.customer,
        "amount": 100,
        "reason": "  Opening  ",
        "adjusted_at": "2026-01-01T10:00:00+05:00",
    }
    first = auth_client.post(PATH, json=payload)
    assert first.status_code == 201
    retry = auth_client.post(
        PATH, json={**payload, "reason": "Opening", "adjusted_at": "2026-01-01T05:00:00Z"}
    )
    assert retry.status_code == 200 and retry.json() == first.json()
    conflict = auth_client.post(PATH, json={**payload, **change})
    assert (
        conflict.status_code == 409
        and conflict.json()["code"] == "debt_adjustment_request_conflict"
    )
    cancelled = auth_client.post(
        f"{PATH}/{first.json()['id']}/cancel", json={"reason": "Ошибка"}
    ).json()
    assert auth_client.post(PATH, json=payload).json() == cancelled


def test_replay_without_date_and_negative_replay(auth_client, return_case):
    first = post(auth_client, return_case.customer, 100)
    body = {
        "request_id": first.json()["request_id"],
        "customer_id": return_case.customer,
        "amount": 100,
        "reason": "Бастапқы қалдық",
    }
    assert auth_client.post(PATH, json=body).status_code == 200
    reduction = post(auth_client, return_case.customer, -100)
    body.update(request_id=reduction.json()["request_id"], amount=-100)
    assert auth_client.post(PATH, json=body).status_code == 200
    assert current_debt(return_case.db, return_case.customer) == 0


@pytest.mark.parametrize(
    "changes,field",
    [
        ({"amount": 0}, "amount"),
        ({"amount": 1.5}, "amount"),
        ({"amount": True}, "amount"),
        ({"amount": "1"}, "amount"),
        ({"amount": 2**63}, "amount"),
        ({"amount": -(2**63) - 1}, "amount"),
        ({"reason": ""}, "reason"),
        ({"reason": "   "}, "reason"),
        ({"reason": "aa"}, "reason"),
        ({"reason": "a" * 501}, "reason"),
        ({"reason": None}, "reason"),
        ({"adjusted_at": "2026-01-01T10:00:00"}, "adjusted_at"),
        ({"adjusted_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat()}, "adjusted_at"),
    ],
)
def test_validation(auth_client, return_case, changes, field):
    response = (
        post(auth_client, return_case.customer, 100, **changes)
        if "amount" not in changes
        else post(
            auth_client,
            return_case.customer,
            changes["amount"],
            **{k: v for k, v in changes.items() if k != "amount"},
        )
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"
    assert response.json()["errors"][0]["field"] == field


def test_clock_tolerance_and_missing_fields(auth_client, return_case):
    assert (
        post(
            auth_client,
            return_case.customer,
            100,
            adjusted_at=(datetime.now(UTC) + timedelta(seconds=30)).isoformat(),
        ).status_code
        == 201
    )
    for field in ("request_id", "customer_id", "amount", "reason"):
        payload = {
            "request_id": str(uuid.uuid4()),
            "customer_id": return_case.customer,
            "amount": 1,
            "reason": "Opening",
        }
        del payload[field]
        assert auth_client.post(PATH, json=payload).status_code == 422
    assert (
        auth_client.post(
            PATH,
            json={
                "request_id": str(uuid.uuid4()),
                "customer_id": return_case.customer,
                "amount": 1,
                "reason": "Opening",
                "unknown": 1,
            },
        ).status_code
        == 422
    )


def test_errors_and_gapless_numbering(auth_client, return_case):
    case = return_case
    first = post(auth_client, case.customer, 100).json()
    assert post(auth_client, case.customer, -101).status_code == 409
    assert post(auth_client, 9223372036854775807, 1).json()["code"] == "document_customer_not_found"
    assert (
        auth_client.get(PATH + "/9223372036854775807").json()["code"] == "debt_adjustment_not_found"
    )
    assert (
        auth_client.post(PATH + "/9223372036854775807/cancel", json={"reason": "Ошибка"}).json()[
            "code"
        ]
        == "debt_adjustment_not_found"
    )
    assert auth_client.post(f"{PATH}/{first['id']}/cancel", json={"reason": ""}).status_code == 422
    assert post(auth_client, case.customer, 1).json()["number"] == first["number"] + 1
    last = case.db.scalar(
        select(DocumentCounter.last_number).where(DocumentCounter.doc_type == "debt_adjustment")
    )
    with case.db.begin_nested() as tx:
        assert next_number(case.db, "debt_adjustment") == last + 1
        tx.rollback()
    assert adjust(case, 10).number == last + 1


def test_list_filters_signed_totals_and_almaty_days(auth_client, return_case):
    case = return_case
    other = create_customer(case.db)
    first = post(auth_client, case.customer, 100, adjusted_at="2026-03-10T18:59:00Z").json()
    second = post(auth_client, case.customer, -30, adjusted_at="2026-03-10T19:00:00Z").json()
    cancelled = post(auth_client, other.id, 50, adjusted_at="2026-03-11T10:00:00Z").json()
    auth_client.post(f"{PATH}/{cancelled['id']}/cancel", json={"reason": "Ошибка"})
    page = auth_client.get(PATH + "?limit=1&offset=1").json()
    assert page["total"] == 3 and page["sum_posted"] == 70 and page["items"] == [second]
    for item in auth_client.get(PATH).json()["items"]:
        assert item == auth_client.get(f"{PATH}/{item['id']}").json()
    assert auth_client.get(PATH + "?from=2026-03-10&to=2026-03-10").json()["items"] == [first]
    assert auth_client.get(
        PATH + f"?from=2026-03-11&to=2026-03-11&customer_id={case.customer}"
    ).json()["items"] == [second]
    assert auth_client.get(PATH + "?status=cancelled").json()["sum_posted"] == 0
    assert auth_client.get(PATH + "?status=posted").json()["total"] == 2
    for query in ("limit=0", "limit=201", "offset=-1", "status=other", "customer_id=0"):
        assert auth_client.get(PATH + "?" + query).status_code == 422


def test_ledger_reason_signed_amount_pagination_and_cancellation(auth_client, return_case):
    case = return_case
    opening = adjust(case, 500, adjusted_at=AT - timedelta(days=1), reason="Бастапқы қалдық")
    sale = make_sale(case, qty=1)
    negative = adjust(case, -200, adjusted_at=AT + timedelta(hours=1), reason="Қарыз кешірілді")
    # Make a real second page, not just an offset into two records.
    for index in range(49):
        adjust(case, 1, adjusted_at=AT + timedelta(hours=2, seconds=index))
    page = auth_client.get(f"/api/customers/{case.customer}/ledger?limit=50&offset=50").json()
    assert page["total"] == 52
    assert [(row["kind"], row["id"]) for row in page["items"]] == [
        ("sale", sale.id),
        ("adjustment", opening.id),
    ]
    assert [row["debt_after"] for row in page["items"]] == [600, 500]
    entries = auth_client.get(f"/api/customers/{case.customer}/ledger?limit=200").json()["items"]
    reduction = next(
        row for row in entries if row["kind"] == "adjustment" and row["id"] == negative.id
    )
    assert reduction["amount"] == reduction["debt_change"] == -200
    assert reduction["reason"] == "Қарыз кешірілді" and reduction["debt_after"] == 400
    assert reduction["payment_method"] is None and reduction["paid_at_sale"] is None
    assert next(row for row in entries if row["kind"] == "sale")["reason"] is None
    cancel_debt_adjustment(case.db, negative.id, "Ошибка", case.user)
    assert auth_client.get(f"/api/customers/{case.customer}/ledger").json()["total"] == 51
    assert current_debt(case.db, case.customer) == 649


def test_fifo_opening_debt_before_invoices_and_negative_credit(return_case):
    case = return_case
    opening = adjust(case, 500, adjusted_at=AT - timedelta(days=1))
    first = make_sale(case, qty=5)
    second = make_sale(case, qty=10, at=AT + timedelta(days=1))
    pay(case, 300)
    positions = invariant(case)
    assert positions[("adjustment", opening.id)] == 200
    assert positions[("sale", first.id)] == 500 and positions[("sale", second.id)] == 1000
    assert get_sale(case.db, first.id).payment_status == "unpaid"
    negative = adjust(case, -400, adjusted_at=AT - timedelta(days=2))
    assert invariant(case)[("sale", first.id)] == 300
    assert get_sale(case.db, first.id).payment_status == "partial"
    # A return belongs to its own invoice before entering the common credit pool.
    returned = post_return(case.db, return_data(second, 10), case.user)[0]
    assert invariant(case)[("sale", first.id)] == 300
    assert get_sale(case.db, second.id).payment_status == "returned"
    cancel_return(case.db, returned.id, "Ошибка", case.user)
    assert invariant(case)[("sale", second.id)] == 1000
    cancel_debt_adjustment(case.db, negative.id, "Ошибка", case.user)
    assert invariant(case)[("adjustment", opening.id)] == 200
    pay(case, 1700)
    assert current_debt(case.db, case.customer) == 0
    cancel_debt_adjustment(case.db, opening.id, "Ошибка", case.user)
    assert current_debt(case.db, case.customer) == -500
    assert all(value == 0 for value in invariant(case).values())
    cancel_sale(case.db, first.id, "Ошибка", case.user)
    invariant(case)


def test_fifo_equal_timestamps_adjustment_before_sale_and_later_debt(return_case):
    case = return_case
    sale = make_sale(case, qty=5)
    opening = adjust(case, 500, adjusted_at=AT)
    later = adjust(case, 500, adjusted_at=AT + timedelta(days=1))
    pay(case, 700)
    positions = invariant(case)
    assert positions == {
        ("sale", sale.id): 300,
        ("adjustment", opening.id): 0,
        ("adjustment", later.id): 500,
    }


def test_payments_and_return_expected_split_use_adjusted_debt(auth_client, return_case):
    case = return_case
    sale = make_sale(case, qty=10, paid=800)
    adjust(case, 500)
    assert auth_client.post(
        "/api/payments",
        json={"request_id": str(uuid.uuid4()), "customer_id": case.customer, "amount": 701},
    ).json()["params"] == {"debt": 700, "amount": 701}
    pay(case, 100)
    adjust(case, -400)
    data = return_data(sale, 5, expected_debt_credit=500, expected_refund_amount=0)
    response = auth_client.post("/api/returns", json=data.model_dump(mode="json"))
    assert response.status_code == 409 and response.json()["code"] == "return_split_changed"
    assert response.json()["params"] == {"debt_credit": 200, "refund_amount": 300}
    data.expected_debt_credit = 200
    data.expected_refund_amount = 300
    returned = post_return(case.db, data, case.user)[0]
    assert (returned.debt_credit, returned.refund_amount) == (200, 300)
    invariant(case)


def test_adjustments_do_not_change_reports(auth_client, return_case):
    case = return_case
    make_sale(case, qty=10, paid=300)
    urls = [
        f"/api/reports/{name}?from=2026-01-01&to=2026-12-31"
        for name in ("summary", "products", "customers")
    ]
    before = [auth_client.get(url).json() for url in urls]
    positive = adjust(case, 500, adjusted_at=AT)
    adjust(case, -300, adjusted_at=AT)
    assert [auth_client.get(url).json() for url in urls] == before
    cancel_debt_adjustment(case.db, positive.id, "Ошибка", case.user)
    assert [auth_client.get(url).json() for url in urls] == before


@pytest.mark.parametrize(
    "changes",
    [
        {"amount": 0},
        {"reason": ""},
        {"reason": "   "},
        {"reason": None},
        {"status": "other"},
        {"customer_id": None},
    ],
)
def test_database_constraints(return_case, changes):
    case = return_case
    tx = case.db.begin_nested()
    case.db.add(
        CustomerDebtAdjustment(
            number=1000,
            request_id=uuid.uuid4(),
            created_by=case.user,
            **{"customer_id": case.customer, "amount": 100, "reason": "Opening", **changes},
        )
    )
    with pytest.raises(IntegrityError):
        case.db.flush()
    tx.rollback()

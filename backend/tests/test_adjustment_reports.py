import uuid
from datetime import date, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import event

from app.demo import _historical_adjustment
from app.inventory.service import MovementIn, post_movements
from app.reports import service
from app.returns.service import cancel_return
from app.sales.models import SaleLine
from app.sales.schemas import SaleCreate, SaleLineIn
from app.sales.service import cancel_sale, post_sale
from tests.factories import create_product, create_user
from tests.return_helpers import post_return

PERIOD = {"from": "2026-01-10", "to": "2026-01-12"}
START, END = date(2026, 1, 10), date(2026, 1, 12)


def adjust(db, product, user, qty, at="2026-01-12T18:30:00+00:00", reason="Пересорт"):
    return _historical_adjustment(
        db,
        MovementIn(product.id, qty, "adjustment", note=reason),
        user.id,
        datetime.fromisoformat(at),
    )


def test_reference_12_uses_movement_snapshot_and_keeps_profit(auth_client, db_session):
    user = create_user(db_session)
    product = create_product(db_session)
    post_movements(db_session, [MovementIn(product.id, 10, "receipt", unit_cost=201250)], user.id)
    movement = adjust(db_session, product, user, -3)
    post_movements(db_session, [MovementIn(product.id, 7, "receipt", unit_cost=800000)], user.id)
    result = auth_client.get("/api/reports/summary", params=PERIOD).json()
    assert result["write_off_value"] == 603750
    assert result["write_off_count"] == 1
    assert result["revenue"] == result["cost"] == result["profit"] == result["defect_loss"] == 0
    assert result["sales_count"] == 0
    rows = auth_client.get(
        "/api/reports/adjustments", params={**PERIOD, "direction": "minus"}
    ).json()
    assert rows["items"][0]["value"] == 603750
    assert rows["items"][0]["movement_id"] == movement.id


def test_adjustments_boundaries_unknown_zero_and_both_directions(auth_client, db_session):
    user = create_user(db_session)
    known, unknown, zero = [create_product(db_session) for _ in range(3)]
    post_movements(
        db_session,
        [
            MovementIn(known.id, 20, "receipt", unit_cost=123),
            MovementIn(unknown.id, 10, "receipt"),
            MovementIn(zero.id, 10, "receipt", unit_cost=0),
        ],
        user.id,
    )
    adjust(db_session, known, user, -2, "2026-01-09T19:00:00Z")
    adjust(db_session, known, user, 3)
    adjust(db_session, zero, user, -1)
    adjust(db_session, unknown, user, -1)
    adjust(db_session, unknown, user, 1)
    adjust(db_session, known, user, -5, "2026-01-09T18:59:59Z")
    adjust(db_session, known, user, -5, "2026-01-12T19:00:00Z")
    result = auth_client.get("/api/reports/summary", params=PERIOD).json()
    assert (result["write_off_value"], result["write_off_count"]) == (246, 2)
    assert result["surplus_value"] == 369
    assert result["adjustment_unknown_count"] == 2
    for direction, expected in [("minus", 3), ("plus", 2)]:
        page = auth_client.get(
            "/api/reports/adjustments", params={**PERIOD, "direction": direction}
        ).json()
        assert page["total"] == expected
        assert sum(row["value"] is None for row in page["items"]) == 1


def test_adjustments_list_fields_current_catalog_sort_and_pages(auth_client, db_session):
    user = create_user(db_session, full_name="Автор")
    product = create_product(db_session, article="BEFORE")
    post_movements(db_session, [MovementIn(product.id, 20, "receipt", unit_cost=100)], user.id)
    first = adjust(db_session, product, user, -1, "2026-01-10T10:00:00Z")
    second = adjust(db_session, product, user, -2)
    third = adjust(db_session, product, user, -3)
    product.article, product.name, product.unit, product.is_archived = (
        "AFTER",
        "Новое имя",
        "л",
        True,
    )
    db_session.flush()
    params = {**PERIOD, "direction": "minus"}
    data = auth_client.get("/api/reports/adjustments", params=params).json()
    assert data["total"] == 3
    assert [row["movement_id"] for row in data["items"]] == [third.id, second.id, first.id]
    assert data["items"][0] == {
        "movement_id": third.id,
        "created_at": third.created_at.isoformat().replace("+00:00", "Z"),
        "product_id": product.id,
        "article": "AFTER",
        "name": "Новое имя",
        "unit": "л",
        "qty": -3,
        "unit_cost": 100,
        "value": 300,
        "reason": "Пересорт",
        "created_by_name": "Автор",
    }
    assert auth_client.get(
        "/api/reports/adjustments", params={**params, "limit": 1, "offset": 1}
    ).json() == {
        "items": data["items"][1:2],
        "total": 3,
    }
    assert auth_client.get("/api/reports/adjustments", params={**params, "offset": 99}).json() == {
        "items": [],
        "total": 3,
    }


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"direction": "bad"},
        {"limit": 0},
        {"limit": 201},
        {"offset": -1},
        {"from": "bad"},
        {"to": "2026-01-09"},
        {"to": "2027-01-12"},
    ],
)
def test_adjustment_report_validation(auth_client, params):
    query = {**PERIOD, "direction": "minus", **params}
    if not params:
        query.pop("direction")
    response = auth_client.get("/api/reports/adjustments", params=query)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_adjustments_report_protected(client):
    assert (
        client.get("/api/reports/adjustments", params={**PERIOD, "direction": "minus"}).status_code
        == 401
    )


def test_adjustments_query_count_is_constant(db_session):
    statements = []
    conn = db_session.connection()

    def record(*args):
        statements.append(args[2])

    for count in [1, 20]:
        for _ in range(count):
            user = create_user(db_session)
            product = create_product(db_session)
            post_movements(
                db_session, [MovementIn(product.id, 2, "receipt", unit_cost=100)], user.id
            )
            adjust(db_session, product, user, -1)
        # A warm identity map must not hide per-row product or author lookups.
        db_session.expunge_all()
        event.listen(conn, "before_cursor_execute", record)
        try:
            statements.clear()
            result = service.adjustments(db_session, START, END, "minus", 50, 0)
            assert result.total == (1 if count == 1 else 21)
            assert len(statements) == 2
        finally:
            event.remove(conn, "before_cursor_execute", record)


def discounted_sale(db, user, product, qty=2, at="2026-01-10T10:00:00Z", price=9000):
    return post_sale(
        db,
        SaleCreate(
            request_id=uuid.uuid4(),
            sold_at=at,
            lines=[SaleLineIn(product_id=product.id, qty=qty, unit_price=price)],
        ),
        user.id,
    )[0]


@pytest.mark.parametrize("condition", ["good", "defective"])
def test_discount_reference_and_return_subtracts_for_both_conditions(
    auth_client, db_session, condition
):
    user = create_user(db_session)
    product = create_product(db_session, sale_price=10000)
    post_movements(db_session, [MovementIn(product.id, 20, "receipt", unit_cost=5000)], user.id)
    sale = discounted_sale(db_session, user, product)
    discounted_sale(db_session, user, product, qty=1, price=10500)
    assert service.summary(db_session, START, END).discount_total == 2000
    case = SimpleNamespace(db=db_session, user=user.id)
    returned = post_return(
        case, sale, 1, condition, returned_at="2026-01-11T10:00:00Z", refund_method="cash"
    )
    summary = service.summary(db_session, START, END)
    assert summary.discount_total == 1000
    assert summary.write_off_value == summary.write_off_count == 0
    assert summary.defect_loss == (5000 if condition == "defective" else 0)
    cancel_return(db_session, returned.id, "Ошибочный возврат", user.id)
    assert service.summary(db_session, START, END).discount_total == 2000
    cancel_sale(db_session, sale.id, "Ошибочная продажа", user.id)
    assert service.summary(db_session, START, END).discount_total == 0


def test_return_of_past_sale_negative_discount_and_unknown_count(db_session):
    user = create_user(db_session)
    product = create_product(db_session, sale_price=10000)
    post_movements(db_session, [MovementIn(product.id, 20, "receipt", unit_cost=5000)], user.id)
    sale = discounted_sale(db_session, user, product, at="2026-01-09T10:00:00Z")
    case = SimpleNamespace(db=db_session, user=user.id)
    post_return(case, sale, 1, returned_at="2026-01-10T10:00:00Z", refund_method="cash")
    assert service.summary(db_session, START, END).discount_total == -1000
    old = discounted_sale(db_session, user, product)
    line = db_session.get(SaleLine, old.lines[0].id)
    line.list_price = None
    db_session.flush()
    result = service.summary(db_session, START, END)
    assert result.discount_unknown_count == 1
    assert result.discount_total == -1000
    post_return(case, old, 1, returned_at="2026-01-11T10:00:00Z", refund_method="cash")
    result = service.summary(db_session, START, END)
    assert result.discount_unknown_count == 1 and result.discount_total == -1000


def test_large_integer_adjustment_value(db_session):
    user = create_user(db_session)
    product = create_product(db_session)
    post_movements(
        db_session, [MovementIn(product.id, 100000, "receipt", unit_cost=100000000001)], user.id
    )
    adjust(db_session, product, user, -99999)
    expected = 99999 * 100000000001
    assert service.summary(db_session, START, END).write_off_value == expected
    assert service.adjustments(db_session, START, END, "minus", 50, 0).items[0].value == expected

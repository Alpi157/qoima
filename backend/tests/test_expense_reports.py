import uuid
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import event

from app.expenses.schemas import ExpenseCreate
from app.expenses.service import post_expenses
from app.inventory.service import MovementIn, post_movements
from app.reports import service
from app.settings.models import BusinessSettings
from tests.conftest import TestSessionLocal
from tests.factories import create_product, create_user


def sale(client, product, qty, price, at, paid=None, method=None):
    body = {
        "request_id": str(uuid.uuid4()),
        "sold_at": at,
        "lines": [{"product_id": product.id, "qty": qty, "unit_price": price}],
    }
    if paid is not None:
        body["paid_amount"] = paid
    if method:
        body["payment_method"] = method
    response = client.post("/api/sales", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def returned(client, document, qty, condition, at):
    response = client.post(
        "/api/returns",
        json={
            "request_id": str(uuid.uuid4()),
            "sale_id": document["id"],
            "returned_at": at,
            "refund_method": "card",
            "lines": [
                {"sale_line_id": document["lines"][0]["id"], "qty": qty, "condition": condition}
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def reference_13_case(auth_client, db_session):
    user = create_user(db_session)
    product = create_product(db_session)
    defect = create_product(db_session)
    post_movements(
        db_session,
        [
            MovementIn(product.id, 2, "receipt", unit_cost=59000000),
            MovementIn(defect.id, 1, "receipt", unit_cost=1000000),
        ],
        user.id,
    )
    db_session.commit()
    sale(auth_client, product, 1, 100000000, "2026-09-10T10:00:00+05:00", method="cash")
    defective_sale = sale(
        auth_client, defect, 1, 1000000, "2026-09-10T11:00:00+05:00", method="card"
    )
    returned(auth_client, defective_sale, 1, "defective", "2026-09-10T12:00:00+05:00")
    # An earlier credit sale supplies the debt; only its card payment enters this period.
    from app.payments.schemas import PaymentCreate
    from app.payments.service import post_payment
    from tests.factories import create_customer

    customer = create_customer(db_session)
    debt_product = create_product(db_session)
    post_movements(db_session, [MovementIn(debt_product.id, 1, "receipt", unit_cost=1)], user.id)
    db_session.commit()
    response = auth_client.post(
        "/api/sales",
        json={
            "request_id": str(uuid.uuid4()),
            "customer_id": customer.id,
            "sold_at": "2026-08-01T10:00:00+05:00",
            "paid_amount": 0,
            "lines": [{"product_id": debt_product.id, "qty": 1, "unit_price": 40000000}],
        },
    )
    assert response.status_code == 201, response.text
    post_payment(
        db_session,
        PaymentCreate(
            request_id=uuid.uuid4(),
            customer_id=customer.id,
            amount=40000000,
            payment_method="card",
            paid_at="2026-09-10T10:00:00+05:00",
        ),
        user.id,
    )
    settings = db_session.get(BusinessSettings, 1)
    settings.card_commission_bp = 100
    settings.tax_bp = 300
    # Current-period adjustments always receive their actual insertion time.
    adjustment_product = create_product(db_session)
    post_movements(
        db_session, [MovementIn(adjustment_product.id, 3, "receipt", unit_cost=500000)], user.id
    )
    post_movements(
        db_session, [MovementIn(adjustment_product.id, -1, "adjustment", note="Write-off")], user.id
    )
    today = datetime.now(UTC).astimezone(ZoneInfo("Asia/Almaty")).date()
    post_expenses(
        db_session,
        ExpenseCreate(
            request_id=uuid.uuid4(),
            items=[{"expense_date": "2026-09-10", "category": "rent", "amount": 10000000}],
        ),
        user.id,
    )
    return {
        "client": auth_client,
        "db": db_session,
        "user": user.id,
        "adjustment": adjustment_product.id,
        "period": {"from": "2026-09-01", "to": today.isoformat()},
    }


def test_reference_13(reference_13_case):
    case = reference_13_case
    result = case["client"].get("/api/reports/summary", params=case["period"]).json()
    expected = {
        "revenue": 100000000,
        "cost": 60000000,
        "defect_loss": 1000000,
        "profit": 40000000,
        "write_off_value": 500000,
        "card_commission": 400000,
        "tax_estimate": 3000000,
        "expenses_total": 10000000,
        "operating_total": 13400000,
        "profit_after_expenses": 26100000,
    }
    assert {key: result[key] for key in expected} == expected
    assert result["received"]["card"] == 40000000


def test_reference_14(reference_13_case):
    case = reference_13_case
    post_movements(
        case["db"], [MovementIn(case["adjustment"], 1, "adjustment", note="Mix-up")], case["user"]
    )
    case["db"].commit()
    result = case["client"].get("/api/reports/summary", params=case["period"]).json()
    assert result["surplus_value"] == 500000
    assert result["profit_after_expenses"] == 26600000


@pytest.mark.parametrize("paid,bp,expected", [(33333300, 95, 316666), (50, 100, 1)])
def test_commission_rounding(auth_client, db_session, paid, bp, expected):
    user = create_user(db_session)
    product = create_product(db_session)
    post_movements(db_session, [MovementIn(product.id, 1, "receipt", unit_cost=1)], user.id)
    settings = db_session.get(BusinessSettings, 1)
    settings.card_commission_bp = bp
    db_session.commit()
    sale(auth_client, product, 1, paid, "2026-09-10T10:00:00+05:00", method="card")
    assert (
        auth_client.get(
            "/api/reports/summary", params={"from": "2026-09-10", "to": "2026-09-10"}
        ).json()["card_commission"]
        == expected
    )


def test_negative_revenue_and_card_have_zero_estimates(auth_client, db_session):
    user = create_user(db_session)
    product = create_product(db_session)
    post_movements(db_session, [MovementIn(product.id, 1, "receipt", unit_cost=1)], user.id)
    settings = db_session.get(BusinessSettings, 1)
    settings.card_commission_bp = 100
    settings.tax_bp = 300
    db_session.commit()
    document = sale(auth_client, product, 1, 1000, "2026-09-10T10:00:00+05:00", method="card")
    returned(auth_client, document, 1, "good", "2026-09-11T10:00:00+05:00")
    result = auth_client.get(
        "/api/reports/summary", params={"from": "2026-09-11", "to": "2026-09-11"}
    ).json()
    assert result["revenue"] < 0 and result["received"]["card"] < 0
    assert result["card_commission"] == result["tax_estimate"] == 0


from tests import test_buy_today as buy_today_tests  # noqa: E402

current_rates = buy_today_tests.current_rates
purchase = buy_today_tests.purchase


def test_reference_11(auth_client, purchase):
    product, _ = purchase()
    sale(auth_client, product, 50, 1450000, "2026-10-11T10:00:00+05:00")
    result = auth_client.get(
        "/api/reports/summary", params={"from": "2026-10-11", "to": "2026-10-11"}
    ).json()
    expected = {
        "revenue": 72500000,
        "cost": 40250000,
        "profit": 32250000,
        "buy_today_cost": 48125000,
        "buy_today_base_cost": 40250000,
        "rate_effect": 7875000,
    }
    assert {key: result[key] for key in expected} == expected


def test_rate_effect_matched_rows_and_good_return(auth_client, db_session, purchase):
    user = create_user(db_session)
    product, _ = purchase()
    first = sale(auth_client, product, 3, 1450000, "2026-10-11T10:00:00+05:00")
    returned(auth_client, first, 1, "good", "2026-10-11T11:00:00+05:00")
    unknown = create_product(db_session)
    post_movements(db_session, [MovementIn(unknown.id, 2, "adjustment")], user.id)
    db_session.commit()
    # A quote gives today's value, but cannot supply the missing historical sale snapshot.
    assert (
        auth_client.post(
            f"/api/products/{unknown.id}/price-quotes",
            json={
                "request_id": str(uuid.uuid4()),
                "currency": "KZT",
                "price_minor": 900,
                "quoted_on": "2026-10-10",
            },
        ).status_code
        == 201
    )
    sale(auth_client, unknown, 1, 1000, "2026-10-11T10:00:00+05:00")
    no_today = create_product(db_session)
    post_movements(db_session, [MovementIn(no_today.id, 2, "adjustment", unit_cost=700)], user.id)
    db_session.commit()
    sale(auth_client, no_today, 1, 1000, "2026-10-11T10:00:00+05:00")
    result = auth_client.get(
        "/api/reports/summary", params={"from": "2026-10-11", "to": "2026-10-11"}
    ).json()
    assert result["buy_today_cost"] == 1925000
    assert result["buy_today_base_cost"] == 1610000
    assert result["rate_effect"] == 315000
    assert result["buy_today_unknown_count"] == 2


def test_summary_queries_constant(auth_client, db_session, purchase):
    counts = []
    for count in (1, 8):
        for _ in range(count):
            product, _ = purchase()
            sale(auth_client, product, 1, 1450000, "2026-10-11T10:00:00+05:00")
        statements = []

        def record(*args, statements=statements):
            statements.append(args[2])

        conn = db_session.connection()
        event.listen(conn, "before_cursor_execute", record)
        try:
            service.summary(
                db_session, date(2026, 10, 11), date(2026, 10, 11), session_factory=TestSessionLocal
            )
            counts.append(len(statements))
        finally:
            event.remove(conn, "before_cursor_execute", record)
    assert counts[0] == counts[1]

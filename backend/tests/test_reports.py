import uuid
from datetime import date

import pytest
from sqlalchemy import event

from app.inventory.service import MovementIn, post_movements
from app.payments.schemas import PaymentCreate
from app.payments.service import post_payment
from app.reports import service
from app.sales.schemas import SaleCreate, SaleLineIn
from app.sales.service import cancel_sale, post_sale
from tests.factories import create_customer, create_product, create_user

PERIOD = {"from": "2026-01-10", "to": "2026-01-12"}


@pytest.fixture
def report_case(db_session):
    user = create_user(db_session)
    a = create_product(db_session, article="REP-A", sale_price=300)
    b = create_product(db_session, article="REP-B", sale_price=200)
    c1 = create_customer(db_session, name="First")
    c2 = create_customer(db_session, name="Second")
    post_movements(
        db_session,
        [MovementIn(a.id, 20, "receipt", unit_cost=100), MovementIn(b.id, 20, "adjustment")],
        user.id,
    )

    def sale(customer, lines, at, paid=None, method=None):
        return post_sale(
            db_session,
            SaleCreate(
                request_id=uuid.uuid4(),
                customer_id=customer,
                sold_at=at,
                paid_amount=paid,
                payment_method=method,
                lines=[SaleLineIn(product_id=p, qty=q) for p, q in lines],
            ),
            user.id,
        )[0]

    sale(c1.id, [(a.id, 2)], "2026-01-10T00:00:00+05:00", 100)
    sale(c2.id, [(a.id, 1), (b.id, 2)], "2026-01-10T23:59:59+05:00", 200, "card")
    sale(None, [(b.id, 1)], "2026-01-11T00:00:00+05:00", method="card")
    cancelled = sale(c1.id, [(a.id, 1)], "2026-01-10T12:00:00+05:00")
    cancel_sale(db_session, cancelled.id, "Отменённая продажа", user.id)
    sale(None, [(a.id, 1)], "2026-01-09T23:59:59+05:00")
    sale(None, [(a.id, 1)], "2026-01-13T00:00:00+05:00")
    for customer, amount, method, at in [
        (c1.id, 150, "card", "2026-01-10T10:00:00+05:00"),
        (c2.id, 100, "cash", "2026-01-11T09:00:00+05:00"),
    ]:
        post_payment(
            db_session,
            PaymentCreate(
                request_id=uuid.uuid4(),
                customer_id=customer,
                amount=amount,
                payment_method=method,
                paid_at=at,
            ),
            user.id,
        )
    return a, b, c1, c2


def test_summary_numbers(auth_client, report_case):
    response = auth_client.get("/api/reports/summary", params=PERIOD)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "revenue": 1500,
        "sales_count": 3,
        "cost": 300,
        "profit": 600,
        "revenue_unknown_cost": 600,
        "debt_given": 1000,
        "received": {"cash": 200, "card": 550, "total": 750},
        "days": [
            {"date": "2026-01-10", "revenue": 1300, "profit": 600},
            {"date": "2026-01-11", "revenue": 200, "profit": 0},
            {"date": "2026-01-12", "revenue": 0, "profit": 0},
        ],
    }


def test_product_and_customer_numbers_sort_and_pages(auth_client, report_case):
    a, b, c1, c2 = report_case
    products = auth_client.get("/api/reports/products", params=PERIOD).json()
    assert products == {
        "total": 2,
        "items": [
            {
                "product_id": a.id,
                "article": a.article,
                "name": a.name,
                "unit": a.unit,
                "qty": 3,
                "revenue": 900,
                "cost": 300,
                "profit": 600,
                "revenue_unknown_cost": 0,
            },
            {
                "product_id": b.id,
                "article": b.article,
                "name": b.name,
                "unit": b.unit,
                "qty": 3,
                "revenue": 600,
                "cost": 0,
                "profit": 0,
                "revenue_unknown_cost": 600,
            },
        ],
    }
    customers = auth_client.get("/api/reports/customers", params=PERIOD).json()
    assert customers == {
        "total": 3,
        "items": [
            {
                "customer_id": c2.id,
                "name": c2.name,
                "sales_count": 1,
                "revenue": 700,
                "profit": 200,
                "revenue_unknown_cost": 400,
            },
            {
                "customer_id": c1.id,
                "name": c1.name,
                "sales_count": 1,
                "revenue": 600,
                "profit": 400,
                "revenue_unknown_cost": 0,
            },
            {
                "customer_id": None,
                "name": None,
                "sales_count": 1,
                "revenue": 200,
                "profit": 0,
                "revenue_unknown_cost": 200,
            },
        ],
    }
    for kind, data in [("products", products), ("customers", customers)]:
        page = auth_client.get(
            f"/api/reports/{kind}", params={**PERIOD, "limit": 1, "offset": 1}
        ).json()
        assert page == {"total": data["total"], "items": data["items"][1:2]}
        empty = auth_client.get(f"/api/reports/{kind}", params={**PERIOD, "offset": 99}).json()
        assert empty == {"total": data["total"], "items": []}


@pytest.mark.parametrize("kind", ["summary", "products", "customers"])
@pytest.mark.parametrize(
    "params",
    [
        {},
        {"from": "2026-01-01"},
        {"to": "2026-01-01"},
        {"from": "bad", "to": "2026-01-01"},
        {"from": "2026-01-02", "to": "2026-01-01"},
        {"from": "2025-01-01", "to": "2026-01-02"},
    ],
)
def test_invalid_report_period(auth_client, kind, params):
    response = auth_client.get(f"/api/reports/{kind}", params=params)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


@pytest.mark.parametrize(
    "path",
    [
        "/api/reports/summary",
        "/api/reports/products",
        "/api/reports/customers",
        "/api/stock/summary",
    ],
)
def test_reports_and_stock_protected(client, path):
    assert client.get(path, params=PERIOD).status_code == 401


def test_empty_report_and_366_day_limit(auth_client):
    response = auth_client.get(
        "/api/reports/summary", params={"from": "2025-01-01", "to": "2026-01-01"}
    )
    assert response.status_code == 200
    result = response.json()
    assert len(result["days"]) == 366
    assert result["revenue"] == result["profit"] == result["cost"] == 0
    assert result["received"] == {"cash": 0, "card": 0, "total": 0}


def test_query_budget(db_session, report_case):
    statements = []
    conn = db_session.connection()

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(conn, "before_cursor_execute", record)
    try:
        for method, expected in [
            (service.summary, 1),
            (service.products, 2),
            (service.customers, 2),
        ]:
            statements.clear()
            args = () if method == service.summary else (50, 0)
            method(db_session, date(2026, 1, 10), date(2026, 1, 12), *args)
            assert len(statements) == expected
    finally:
        event.remove(conn, "before_cursor_execute", record)


def test_customers_unknown_cost_uses_sale_snapshots(auth_client, db_session, report_case):
    _, product, c1, c2 = report_case
    user = create_user(db_session)
    # A later receipt cannot fill in missing costs of already posted sales.
    post_movements(db_session, [MovementIn(product.id, 1, "receipt", unit_cost=100)], user.id)
    rows = auth_client.get("/api/reports/customers", params=PERIOD).json()["items"]
    unknown = {row["customer_id"]: row["revenue_unknown_cost"] for row in rows}
    assert unknown == {c1.id: 0, c2.id: 400, None: 200}


def test_cancelled_payment_excluded_and_archived_sales_retained(
    auth_client, db_session, report_case
):
    from app.payments.service import cancel_payment
    from tests.factories import create_user

    a, _, customer, _ = report_case
    user = create_user(db_session)
    payment, _ = post_payment(
        db_session,
        PaymentCreate(
            request_id=uuid.uuid4(),
            customer_id=customer.id,
            amount=100,
            payment_method="card",
            paid_at="2026-01-10T10:00:00+05:00",
        ),
        user.id,
    )
    cancel_payment(db_session, payment.id, "Ошибочная оплата", user.id)
    a.is_archived = True
    db_session.flush()
    result = auth_client.get("/api/reports/summary", params=PERIOD).json()
    assert result["received"] == {"cash": 200, "card": 550, "total": 750}
    assert result["revenue"] == 1500
    assert (
        auth_client.get("/api/reports/products", params=PERIOD).json()["items"][0]["product_id"]
        == a.id
    )


def test_report_ties_sort_by_id_and_merge_anonymous_sales(auth_client, db_session):
    user = create_user(db_session)
    products = [create_product(db_session, sale_price=100) for _ in range(2)]
    customers = [create_customer(db_session) for _ in range(2)]
    post_movements(
        db_session, [MovementIn(p.id, 5, "receipt", unit_cost=0) for p in products], user.id
    )
    for product, customer in zip(products[::-1], customers[::-1], strict=True):
        post_sale(
            db_session,
            SaleCreate(
                request_id=uuid.uuid4(),
                customer_id=customer.id,
                sold_at="2026-01-10T10:00:00+05:00",
                lines=[SaleLineIn(product_id=product.id, qty=1)],
            ),
            user.id,
        )
    for product in products:
        post_sale(
            db_session,
            SaleCreate(
                request_id=uuid.uuid4(),
                sold_at="2026-01-10T10:00:00+05:00",
                lines=[SaleLineIn(product_id=product.id, qty=1, unit_price=50)],
            ),
            user.id,
        )
    result = auth_client.get("/api/reports/products", params=PERIOD).json()
    assert [row["product_id"] for row in result["items"]] == [p.id for p in products]
    result = auth_client.get("/api/reports/customers", params=PERIOD).json()
    assert [row["customer_id"] for row in result["items"]] == [c.id for c in customers] + [None]
    assert result["items"][-1]["sales_count"] == 2
    assert result["items"][-1]["profit"] == 100


def test_received_uses_payment_date_and_almaty_boundaries(auth_client, db_session, report_case):
    _, _, customer, _ = report_case
    user = create_user(db_session)
    post_payment(
        db_session,
        PaymentCreate(
            request_id=uuid.uuid4(),
            customer_id=customer.id,
            amount=100,
            payment_method="cash",
            paid_at="2026-01-09T23:59:59+05:00",
        ),
        user.id,
    )
    day = auth_client.get(
        "/api/reports/summary", params={"from": "2026-01-10", "to": "2026-01-10"}
    ).json()
    assert day["revenue"] == 1300
    assert day["sales_count"] == 2
    assert day["received"] == {"cash": 100, "card": 350, "total": 450}
    next_day = auth_client.get(
        "/api/reports/summary", params={"from": "2026-01-11", "to": "2026-01-11"}
    ).json()
    assert next_day["received"] == {"cash": 100, "card": 200, "total": 300}

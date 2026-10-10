from sqlalchemy import event

from app.catalog.service import frequent_products, get_product, search_products
from app.inventory.service import MovementIn, post_movements, stock_summary
from app.numbering import next_number
from app.receipts.models import Receipt, ReceiptLine
from app.receipts.schemas import ReceiptCreate, ReceiptLineIn
from app.receipts.service import cancel_receipt, post_receipt
from app.sales.schemas import SaleCreate, SaleLineIn
from app.sales.service import post_sale
from tests.factories import create_product, create_user


def test_last_cost_skips_null_and_cancelled_receipts(auth_client, db_session):
    user = create_user(db_session)
    product = create_product(db_session, sale_price=500)
    assert get_product(db_session, product.id).last_cost is None
    post_receipt(
        db_session,
        ReceiptCreate(
            received_at="2026-01-01T10:00:00+05:00",
            lines=[ReceiptLineIn(product_id=product.id, qty=4, unit_cost=100)],
        ),
        user.id,
    )
    # Legacy nullable receipt line, followed by a later cancelled receipt.
    legacy = Receipt(
        number=next_number(db_session, "receipt"),
        received_at="2026-01-02T10:00:00+05:00",
        created_by=user.id,
    )
    db_session.add(legacy)
    db_session.flush()
    db_session.add(ReceiptLine(receipt_id=legacy.id, product_id=product.id, qty=1, unit_cost=None))
    post_movements(
        db_session,
        [MovementIn(product.id, 1, "receipt", doc_type="receipt", doc_id=legacy.id)],
        user.id,
    )
    assert get_product(db_session, product.id).last_cost == 100
    latest = post_receipt(
        db_session,
        ReceiptCreate(
            received_at="2026-01-03T10:00:00+05:00",
            lines=[ReceiptLineIn(product_id=product.id, qty=1, unit_cost=300)],
        ),
        user.id,
    )
    assert get_product(db_session, product.id).last_cost == 300
    cancel_receipt(db_session, latest.id, "Ошибка", user.id)
    assert get_product(db_session, product.id).last_cost == 100
    assert auth_client.get("/api/products").json()["items"][0]["last_cost"] == 100
    # A second known line at the same receipt time wins by its line id.
    post_receipt(
        db_session,
        ReceiptCreate(
            received_at="2026-01-01T10:00:00+05:00",
            lines=[ReceiptLineIn(product_id=product.id, qty=1, unit_cost=0)],
        ),
        user.id,
    )
    assert get_product(db_session, product.id).last_cost == 0


def test_only_unknown_receipt_has_no_last_cost(db_session):
    user = create_user(db_session)
    product = create_product(db_session)
    receipt = Receipt(number=next_number(db_session, "receipt"), created_by=user.id)
    db_session.add(receipt)
    db_session.flush()
    db_session.add(ReceiptLine(receipt_id=receipt.id, product_id=product.id, qty=1))
    post_movements(
        db_session,
        [MovementIn(product.id, 1, "receipt", doc_type="receipt", doc_id=receipt.id)],
        user.id,
    )
    assert get_product(db_session, product.id).last_cost is None
    assert get_product(db_session, product.id).avg_cost is None


def test_stock_summary_filters_and_min_qty(auth_client, db_session):
    user = create_user(db_session)
    a = create_product(db_session, sale_price=300)
    b = create_product(db_session, sale_price=200)
    zero = create_product(db_session, sale_price=100)
    archived = create_product(db_session, sale_price=700, is_archived=True)
    a.min_qty, b.min_qty, zero.min_qty, archived.min_qty = 3, 1, 0, 100
    post_movements(
        db_session,
        [
            MovementIn(a.id, 3, "receipt", unit_cost=100),
            MovementIn(b.id, 2, "adjustment"),
            MovementIn(archived.id, 3, "receipt", unit_cost=500),
        ],
        user.id,
    )
    assert auth_client.get("/api/stock/summary").json() == {
        "products_count": 3,
        "total_qty": 5,
        "cost_value": 300,
        "retail_value": 1300,
        "unknown_cost_count": 1,
        "out_of_stock_count": 1,
        "low_stock_count": 1,
    }
    for state, expected in [("out", zero.id), ("low", a.id)]:
        for include in [False, True]:
            result = auth_client.get(
                "/api/products", params={"stock_state": state, "include_archived": include}
            ).json()
            assert result["total"] == 1
            assert [item["id"] for item in result["items"]] == [expected]
    assert auth_client.get("/api/products", params={"stock_state": "wrong"}).status_code == 422
    cleared = auth_client.patch(f"/api/products/{a.id}", json={"min_qty": None})
    assert cleared.status_code == 200
    assert cleared.json()["min_qty"] is None
    assert auth_client.get("/api/products?stock_state=low").json()["total"] == 0
    assert auth_client.patch(f"/api/products/{b.id}", json={"min_qty": -1}).status_code == 422
    assert auth_client.patch(f"/api/products/{b.id}", json={"min_qty": 1.5}).status_code == 422
    created = auth_client.post(
        "/api/products", json={"article": "NEW-MIN", "name": "New", "sale_price": 0, "min_qty": 0}
    )
    assert created.status_code == 201
    assert created.json()["min_qty"] == 0


def test_empty_stock_summary(auth_client):
    assert set(auth_client.get("/api/stock/summary").json().values()) == {0}


def test_catalog_queries_have_no_n_plus_one(db_session):
    import uuid

    user = create_user(db_session)
    for _ in range(3):
        product = create_product(db_session, sale_price=500)
        post_receipt(
            db_session,
            ReceiptCreate(lines=[ReceiptLineIn(product_id=product.id, qty=2, unit_cost=100)]),
            user.id,
        )
        post_sale(
            db_session,
            SaleCreate(request_id=uuid.uuid4(), lines=[SaleLineIn(product_id=product.id, qty=1)]),
            user.id,
        )
    conn = db_session.connection()
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(conn, "before_cursor_execute", record)
    try:
        page = search_products(db_session, None, False, 50, 0)
        assert len(statements) == 2
        assert all(item.avg_cost == item.last_cost == 100 for item in page.items)
        statements.clear()
        assert len(frequent_products(db_session, 6)) == 3
        assert len(statements) == 1
        statements.clear()
        stock_summary(db_session)
        assert len(statements) == 1
    finally:
        event.remove(conn, "before_cursor_execute", record)

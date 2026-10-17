import uuid
from copy import deepcopy
from datetime import date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import event, func, select, text
from sqlalchemy.exc import IntegrityError

from app.catalog.schemas import MAX_SALE_PRICE
from app.inventory.models import StockBalance, StockMovement
from app.numbering import DocumentCounter
from app.rates.models import ExchangeRate
from app.receipts import service
from app.receipts.models import Receipt, ReceiptExpense, ReceiptExpenseAllocation, ReceiptLine
from app.schema_types import MAX_MONEY
from app.settings.service import get_business_settings
from tests.factories import create_product

DAY = date(2026, 10, 14)
AT = "2026-10-14T20:30:00Z"


@pytest.fixture
def currency_payload(db_session):
    products = [create_product(db_session, article=f"FX-{i}") for i in range(2)]
    db_session.add(
        ExchangeRate(rate_date=DAY, currency="CNY", rate=Decimal("70.0000"), source="nbk")
    )
    db_session.flush()
    return {
        "request_id": str(uuid.uuid4()),
        "currency": "CNY",
        "exchange_rate": "70.0000",
        "rate_source": "nbk",
        "rate_date": DAY.isoformat(),
        "received_at": AT,
        "supplier": "  Supplier ",
        "note": "  Note ",
        "lines": [
            {"product_id": products[0].id, "qty": 100, "unit_price_minor": 10_000},
            {"product_id": products[1].id, "qty": 200, "unit_price_minor": 2500},
        ],
        "expenses": [
            {"kind": "delivery", "amount_minor": 10_500_000},
            {"kind": "customs_duty", "amount_minor": 5_250_000},
        ],
    }


def post(client, payload):
    response = client.post("/api/receipts", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_reference_1_api(auth_client, db_session, currency_payload):
    body = post(auth_client, currency_payload)
    assert (body["currency"], body["exchange_rate"], body["rate_date"], body["rate_source"]) == (
        "CNY",
        "70.0000",
        "2026-10-14",
        "nbk",
    )
    assert body["vat_payer_snapshot"] is False
    assert (
        body["goods_total"],
        body["expenses_total"],
        body["vat_credit_total"],
        body["total_cost"],
    ) == (105_000_000, 15_750_000, 0, 120_750_000)
    assert [line["goods_total"] for line in body["lines"]] == [70_000_000, 35_000_000]
    assert [line["expenses_total"] for line in body["lines"]] == [10_500_000, 5_250_000]
    assert [line["unit_cost"] for line in body["lines"]] == [805_000, 201_250]
    assert [line["unit_price_minor"] for line in body["lines"]] == [10_000, 2500]
    assert [line["vat_credit_total"] for line in body["lines"]] == [0, 0]
    delivery, duty = body["expenses"]
    assert [a["amount_tiyn"] for a in delivery["allocations"]] == [7_000_000, 3_500_000]
    assert [a["amount_tiyn"] for a in duty["allocations"]] == [3_500_000, 1_750_000]
    assert (duty["revaluation_currency"], duty["revaluation_rate"]) == ("CNY", "70.0000")
    assert (delivery["revaluation_currency"], delivery["revaluation_rate"]) == (None, None)
    assert delivery["currency"] == "KZT" and delivery["exchange_rate"] == "1.0000"
    stored = db_session.get(Receipt, body["id"])
    assert stored.currency == "CNY" and stored.exchange_rate == Decimal("70")
    rows = db_session.scalars(
        select(ReceiptLine).where(ReceiptLine.receipt_id == stored.id).order_by(ReceiptLine.id)
    ).all()
    assert [(r.unit_price_minor, r.goods_total, r.expenses_total, r.unit_cost) for r in rows] == [
        (10_000, 70_000_000, 10_500_000, 805_000),
        (2500, 35_000_000, 5_250_000, 201_250),
    ]
    assert db_session.scalar(select(func.count()).select_from(ReceiptExpense)) == 2
    assert db_session.scalar(select(func.count()).select_from(ReceiptExpenseAllocation)) == 4
    for line in body["lines"]:
        pid = line["product_id"]
        assert (
            db_session.scalar(
                select(StockMovement.unit_cost).where(StockMovement.product_id == pid)
            )
            == line["unit_cost"]
        )
        assert (
            db_session.scalar(select(StockBalance.avg_cost).where(StockBalance.product_id == pid))
            == line["unit_cost"]
        )
        assert auth_client.get(f"/api/products/{pid}").json()["last_cost"] == line["unit_cost"]
    assert auth_client.get(f"/api/receipts/{body['id']}").json() == body
    item = auth_client.get("/api/receipts").json()["items"][0]
    assert (item["currency"], item["total_cost"]) == ("CNY", 120_750_000)


@pytest.mark.parametrize("vat", [False, True])
def test_reference_3_4_api(auth_client, db_session, currency_payload, vat):
    settings = get_business_settings(db_session)
    settings.is_vat_payer = vat
    db_session.flush()
    currency_payload["expenses"].append({"kind": "import_vat", "amount_minor": 10_000_000})
    body = post(auth_client, currency_payload)
    assert body["vat_payer_snapshot"] == vat
    assert [line["unit_cost"] for line in body["lines"]] == (
        [805_000, 201_250] if vat else [871_667, 217_917]
    )
    assert body["expenses_total"] == (15_750_000 if vat else 25_750_000)
    assert body["vat_credit_total"] == (10_000_000 if vat else 0)
    assert [line["vat_credit_total"] for line in body["lines"]] == (
        [6_666_667, 3_333_333] if vat else [0, 0]
    )
    expense = body["expenses"][-1]
    assert expense["is_vat_credit"] == vat
    assert expense["revaluation_currency"] == (None if vat else "CNY")
    assert expense["revaluation_rate"] == (None if vat else "70.0000")
    assert [a["amount_tiyn"] for a in expense["allocations"]] == [6_666_667, 3_333_333]


def test_reference_5_precise_totals(auth_client, currency_payload):
    currency_payload.update(exchange_rate="67.83", rate_source="manual")
    currency_payload.pop("rate_date")
    currency_payload["lines"] = [
        {
            "product_id": currency_payload["lines"][0]["product_id"],
            "qty": 3,
            "unit_price_minor": 3333,
        }
    ]
    currency_payload["expenses"] = []
    body = post(auth_client, currency_payload)
    assert (body["total_cost"], body["goods_total"], body["lines"][0]["unit_cost"]) == (
        678_232,
        678_232,
        226_077,
    )
    assert auth_client.get("/api/receipts").json()["items"][0]["total_cost"] == 678_232


def test_reference_6_cancel(auth_client, db_session):
    product = create_product(db_session)

    def receive(cost):
        return post(
            auth_client,
            {
                "request_id": str(uuid.uuid4()),
                "lines": [{"product_id": product.id, "qty": 100, "unit_price_minor": cost}],
            },
        )

    receive(805_000)
    second = receive(962_500)
    assert (
        db_session.scalar(
            select(StockBalance.avg_cost).where(StockBalance.product_id == product.id)
        )
        == 883_750
    )
    response = auth_client.post(
        f"/api/receipts/{second['id']}/cancel", json={"reason": "Ошибка ввода"}
    )
    assert response.status_code == 200
    assert (
        db_session.scalar(
            select(StockBalance.avg_cost).where(StockBalance.product_id == product.id)
        )
        == 805_000
    )


def test_manual_dates_header_and_expense(auth_client, currency_payload):
    currency_payload.update(rate_source="manual")
    currency_payload.pop("rate_date")
    currency_payload["expenses"][0].update(
        currency="USD", exchange_rate="500.1234", rate_source="manual"
    )
    body = post(auth_client, currency_payload)
    assert body["rate_date"] == "2026-10-15"
    assert body["expenses"][0]["rate_date"] == "2026-10-15"
    assert datetime.fromisoformat(body["received_at"]).isoformat() == "2026-10-14T20:30:00+00:00"
    assert body["expenses"][0]["exchange_rate"] == "500.1234"


@pytest.mark.parametrize("where", ["header", "expense"])
@pytest.mark.parametrize("case", ["missing", "different", "after_receipt"])
def test_nbk_rate_checks(auth_client, db_session, currency_payload, where, case):
    target = currency_payload
    prefix = ""
    if where == "expense":
        target = currency_payload["expenses"][0]
        target.update(currency="CNY", exchange_rate="70", rate_source="nbk", rate_date="2026-10-14")
        prefix = "expenses.0."
    if case == "missing":
        target["rate_date"] = "2026-10-13"
    elif case == "different":
        target["exchange_rate"] = "70.0001"
    else:
        target["rate_date"] = "2026-10-16"
    response = auth_client.post("/api/receipts", json=currency_payload)
    assert response.status_code == 422
    error = response.json()
    if case == "after_receipt":
        assert error["code"] == "validation_error"
        assert error["errors"][0]["type"] == "rate_date_after_receipt"
        assert error["errors"][0]["field"] == prefix + "rate_date"
    else:
        assert error["code"] == "nbk_rate_mismatch"
        assert error["params"] == {"currency": "CNY", "rate_date": target["rate_date"]}
    assert db_session.scalar(select(func.count()).select_from(Receipt)) == 0


@pytest.mark.parametrize("where", ["header", "expense"])
@pytest.mark.parametrize(
    "patch,removed,kind,field",
    [
        ({"exchange_rate": 70}, None, "rate_format", "exchange_rate"),
        ({"exchange_rate": True}, None, "rate_format", "exchange_rate"),
        ({"exchange_rate": "1e2"}, None, "rate_format", "exchange_rate"),
        ({"exchange_rate": "0"}, None, "rate_format", "exchange_rate"),
        ({"exchange_rate": "67.12345"}, None, "rate_format", "exchange_rate"),
        ({"exchange_rate": "100000000"}, None, "rate_format", "exchange_rate"),
        ({"exchange_rate": " 70"}, None, "rate_format", "exchange_rate"),
        ({}, "exchange_rate", "rate_required", "exchange_rate"),
        ({}, "rate_source", "rate_required", "rate_source"),
        ({}, "rate_date", "rate_date_required", "rate_date"),
        ({"rate_source": "manual"}, None, "rate_date_not_allowed", "rate_date"),
        ({"currency": "KZT"}, None, "rate_not_allowed", "exchange_rate"),
        ({"rate_source": "other"}, None, "literal_error", "rate_source"),
    ],
)
def test_rate_validation_matrix(auth_client, currency_payload, where, patch, removed, kind, field):
    target = currency_payload
    prefix = ""
    if where == "expense":
        target = currency_payload["expenses"][0]
        target.update(currency="CNY", exchange_rate="70", rate_source="nbk", rate_date="2026-10-14")
        prefix = "expenses.0."
    target.update(patch)
    if removed:
        target.pop(removed)
    response = auth_client.post("/api/receipts", json=currency_payload)
    assert response.status_code == 422, response.text
    assert any(
        error["type"] == kind and error["field"] == prefix + field
        for error in response.json()["errors"]
    )


@pytest.mark.parametrize(
    "case,kind,field",
    [
        ("legacy", "unit_cost_kzt_only", "lines.0.unit_cost"),
        ("both", "line_price_both", "lines.0.unit_price_minor"),
        ("neither", "line_price_required", "lines.0.unit_price_minor"),
        ("selected_missing", "expense_targets_required", "expenses.0.product_ids"),
        ("selected_empty", "expense_targets_required", "expenses.0.product_ids"),
        ("manual_missing", "expense_targets_required", "expenses.0.manual"),
        ("manual_empty", "expense_targets_required", "expenses.0.manual"),
        ("unexpected_targets", "expense_targets_not_allowed", "expenses.0.product_ids"),
        ("unexpected_manual", "expense_targets_not_allowed", "expenses.0.manual"),
        ("selected_unknown", "expense_target_not_in_receipt", "expenses.0.product_ids.0"),
        ("manual_unknown", "expense_target_not_in_receipt", "expenses.0.manual.0.product_id"),
        ("selected_duplicate", "expense_target_duplicate", "expenses.0.product_ids.1"),
        ("manual_duplicate", "expense_target_duplicate", "expenses.0.manual.1.product_id"),
    ],
)
def test_receipt_validation_matrix(auth_client, currency_payload, case, kind, field):
    line = currency_payload["lines"][0]
    expense = currency_payload["expenses"][0]
    pid = line["product_id"]
    if case == "legacy":
        line["unit_cost"] = line.pop("unit_price_minor")
    elif case == "both":
        line["unit_cost"] = line["unit_price_minor"]
    elif case == "neither":
        line.pop("unit_price_minor")
    elif case.startswith("selected"):
        expense["allocation_method"] = "selected"
        if case != "selected_missing":
            expense["product_ids"] = {
                "selected_empty": [],
                "selected_unknown": [99999999],
                "selected_duplicate": [pid, pid],
            }[case]
    elif case.startswith("manual"):
        expense["allocation_method"] = "manual"
        if case != "manual_missing":
            expense["manual"] = {
                "manual_empty": [],
                "manual_unknown": [{"product_id": 99999999, "amount_tiyn": 1}],
                "manual_duplicate": [{"product_id": pid, "amount_tiyn": 1}] * 2,
            }[case]
    elif case == "unexpected_targets":
        expense["product_ids"] = [pid]
    else:
        expense["manual"] = [{"product_id": pid, "amount_tiyn": 1}]
    response = auth_client.post("/api/receipts", json=currency_payload)
    assert response.status_code == 422, response.text
    assert any(
        error["type"] == kind and error["field"] == field for error in response.json()["errors"]
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("amount_minor", 0),
        ("amount_minor", True),
        ("amount_minor", "1"),
        ("amount_minor", 1.5),
        ("amount_minor", MAX_MONEY + 1),
        ("kind", "unknown"),
        ("currency", "EUR"),
        ("allocation_method", "unknown"),
    ],
)
def test_expense_simple_validation(auth_client, currency_payload, field, value):
    currency_payload["expenses"][0][field] = value
    assert auth_client.post("/api/receipts", json=currency_payload).status_code == 422


def test_expense_max_count(auth_client, currency_payload):
    currency_payload["expenses"] = [{"kind": "bank", "amount_minor": 1}] * 51
    assert auth_client.post("/api/receipts", json=currency_payload).status_code == 422


@pytest.mark.parametrize("case", ["goods", "expense", "unit_cost"])
def test_amount_too_large(auth_client, db_session, currency_payload, case):
    currency_payload["expenses"] = []
    if case == "goods":
        currency_payload["lines"][0].update(qty=100_000, unit_price_minor=MAX_SALE_PRICE)
    elif case == "expense":
        currency_payload["expenses"] = [
            {
                "kind": "bank",
                "amount_minor": MAX_MONEY,
                "currency": "USD",
                "exchange_rate": "2",
                "rate_source": "manual",
            }
        ]
    else:
        currency_payload["lines"][0].update(qty=1, unit_price_minor=MAX_SALE_PRICE)
    before = db_session.scalar(
        select(DocumentCounter.last_number).where(DocumentCounter.doc_type == "receipt")
    )
    response = auth_client.post("/api/receipts", json=currency_payload)
    assert response.status_code == 422 and response.json()["code"] == "amount_too_large"
    assert db_session.scalar(select(func.count()).select_from(Receipt)) == 0
    assert db_session.scalar(select(func.count()).select_from(StockMovement)) == 0
    assert (
        db_session.scalar(
            select(DocumentCounter.last_number).where(DocumentCounter.doc_type == "receipt")
        )
        == before
    )


def test_kzt_old_new_alias_replay(auth_client, db_session):
    pid = create_product(db_session).id
    payload = {
        "request_id": str(uuid.uuid4()),
        "lines": [{"product_id": pid, "qty": 3, "unit_cost": 101}],
    }
    first = post(auth_client, payload)
    payload["lines"][0]["unit_price_minor"] = payload["lines"][0].pop("unit_cost")
    response = auth_client.post("/api/receipts", json=payload)
    assert response.status_code == 200 and response.json() == first
    payload["request_id"] = str(uuid.uuid4())
    second = post(auth_client, payload)
    for key in (
        "lines",
        "total_cost",
        "goods_total",
        "expenses_total",
        "currency",
        "exchange_rate",
    ):
        assert second[key] == first[key]


def test_replay_reorders_and_ignores_current_state(
    auth_client, db_session, currency_payload, monkeypatch
):
    pids = [line["product_id"] for line in currency_payload["lines"]]
    currency_payload["expenses"] += [
        {"kind": "bank", "amount_minor": 100, "allocation_method": "selected", "product_ids": pids},
        {
            "kind": "other",
            "amount_minor": 100,
            "allocation_method": "manual",
            "manual": [
                {"product_id": pid, "amount_tiyn": amount}
                for pid, amount in zip(pids, [100, 0], strict=True)
            ],
        },
        {"kind": "bank", "amount_minor": 100},
        {"kind": "bank", "amount_minor": 100},
    ]
    first = post(auth_client, currency_payload)
    settings = get_business_settings(db_session)
    settings.is_vat_payer = True
    db_session.flush()
    replay = deepcopy(currency_payload)
    replay["exchange_rate"] = "70"
    replay["lines"].reverse()
    replay["expenses"][2]["product_ids"].reverse()
    replay["expenses"][3]["manual"].reverse()
    replay["expenses"].reverse()
    replay.update(supplier="Supplier", note="Note", received_at="2026-10-15T01:30:00+05:00")

    def forbidden(*args, **kwargs):
        pytest.fail("Replay must return before current-state checks")

    monkeypatch.setattr(service, "load_line_products", forbidden)
    monkeypatch.setattr(service, "get_business_settings", forbidden)
    monkeypatch.setattr(service, "_currency_snapshot", forbidden)
    response = auth_client.post("/api/receipts", json=replay)
    assert response.status_code == 200 and response.json() == first


@pytest.mark.parametrize(
    "changed",
    [
        "rate",
        "source",
        "currency",
        "price",
        "expense_amount",
        "expense_currency",
        "expense_rate",
        "expense_source",
        "expense_date",
        "expense_kind",
        "method",
        "targets",
        "manual",
        "multiplicity",
    ],
)
def test_currency_replay_conflict(auth_client, currency_payload, changed):
    pids = [line["product_id"] for line in currency_payload["lines"]]
    currency_payload["expenses"] += [
        {"kind": "bank", "amount_minor": 100, "allocation_method": "selected", "product_ids": pids},
        {
            "kind": "other",
            "amount_minor": 100,
            "allocation_method": "manual",
            "manual": [{"product_id": pid, "amount_tiyn": 50} for pid in pids],
        },
        {
            "kind": "broker",
            "amount_minor": 1,
            "currency": "CNY",
            "exchange_rate": "70",
            "rate_source": "nbk",
            "rate_date": "2026-10-14",
        },
    ]
    first = post(auth_client, currency_payload)
    changed_body = deepcopy(currency_payload)
    e = changed_body["expenses"]
    if changed == "rate":
        changed_body["exchange_rate"] = "71"
    elif changed == "source":
        changed_body["rate_source"] = "manual"
        changed_body.pop("rate_date")
    elif changed == "currency":
        changed_body["currency"] = "USD"
    elif changed == "price":
        changed_body["lines"][0]["unit_price_minor"] += 1
    elif changed == "expense_amount":
        e[0]["amount_minor"] += 1
    elif changed == "expense_currency":
        e[4]["currency"] = "USD"
    elif changed == "expense_rate":
        e[4]["exchange_rate"] = "71"
    elif changed == "expense_source":
        e[4]["rate_source"] = "manual"
        e[4].pop("rate_date")
    elif changed == "expense_date":
        e[4]["rate_date"] = "2026-10-13"
    elif changed == "expense_kind":
        e[0]["kind"] = "bank"
    elif changed == "method":
        e[0]["allocation_method"] = "quantity"
    elif changed == "targets":
        e[2]["product_ids"] = pids[:1]
    elif changed == "manual":
        e[3]["manual"][0]["amount_tiyn"] = 49
        e[3]["manual"][1]["amount_tiyn"] = 51
    else:
        e.append(deepcopy(e[0]))
    response = auth_client.post("/api/receipts", json=changed_body)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "receipt_request_conflict"
    assert response.json()["params"] == {"id": first["id"], "number": first["number"]}


def test_manual_replay_without_time_does_not_compare_server_date(
    auth_client, db_session, currency_payload
):
    currency_payload.pop("received_at")
    currency_payload.pop("rate_date")
    currency_payload["rate_source"] = "manual"
    first = post(auth_client, currency_payload)
    # Simulate an old server-generated manual date: request identity excludes this field.
    db_session.execute(
        text("UPDATE receipts SET rate_date = '2026-10-01' WHERE id = :id"), {"id": first["id"]}
    )
    response = auth_client.post("/api/receipts", json=currency_payload)
    assert response.status_code == 200 and response.json()["id"] == first["id"]


def test_zero_selected_manual_and_cancel_preserve_allocations(
    auth_client, db_session, currency_payload
):
    currency_payload["lines"][1]["unit_price_minor"] = 0
    pids = [line["product_id"] for line in currency_payload["lines"]]
    currency_payload["expenses"] = [
        {"kind": "bank", "amount_minor": 10, "allocation_method": "selected", "product_ids": pids},
        {
            "kind": "other",
            "amount_minor": 20,
            "allocation_method": "manual",
            "manual": [
                {"product_id": pid, "amount_tiyn": amount}
                for pid, amount in zip(pids, [20, 0], strict=True)
            ],
        },
    ]
    body = post(auth_client, currency_payload)
    assert [[a["amount_tiyn"] for a in e["allocations"]] for e in body["expenses"]] == [
        [10, 0],
        [20, 0],
    ]
    cancelled = auth_client.post(
        f"/api/receipts/{body['id']}/cancel", json={"reason": "Ошибка ввода"}
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["expenses"] == body["expenses"]
    assert db_session.scalar(select(func.count()).select_from(ReceiptExpenseAllocation)) == 4
    replay = auth_client.post("/api/receipts", json=currency_payload)
    assert replay.status_code == 200 and replay.json() == cancelled.json()


@pytest.mark.parametrize("method", ["amount", "quantity", "selected", "manual"])
def test_allocation_error_or_method(auth_client, db_session, currency_payload, method):
    pid = currency_payload["lines"][0]["product_id"]
    for line in currency_payload["lines"]:
        line["unit_price_minor"] = 0
    expense = {"kind": "bank", "amount_minor": 10, "allocation_method": method}
    if method == "selected":
        expense["product_ids"] = [pid]
    if method == "manual":
        expense["manual"] = [{"product_id": pid, "amount_tiyn": 9}]
    currency_payload["expenses"] = [expense]
    response = auth_client.post("/api/receipts", json=currency_payload)
    if method == "quantity":
        assert response.status_code == 201
        assert len(response.json()["expenses"][0]["allocations"]) == 2
    else:
        assert response.status_code == 422
        assert response.json()["code"] == (
            "expense_manual_sum_mismatch" if method == "manual" else "expense_zero_weight"
        )
        assert response.json()["params"] == (
            {"index": 0, "expected": 10, "actual": 9} if method == "manual" else {"index": 0}
        )


def test_unknown_mixed_totals_and_no_n_plus_one(auth_client, db_session, currency_payload):
    body = post(auth_client, currency_payload)
    # Model historical NULL lines directly; new inputs always require a known price.
    line_ids = db_session.scalars(
        select(ReceiptLine.id).where(ReceiptLine.receipt_id == body["id"]).order_by(ReceiptLine.id)
    ).all()
    db_session.execute(
        text(
            "UPDATE receipt_lines SET unit_cost=NULL, unit_price_minor=NULL, goods_total=NULL "
            "WHERE id=:id"
        ),
        {"id": line_ids[1]},
    )
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    connection = db_session.connection()
    event.listen(connection, "before_cursor_execute", record)
    try:
        result = service.get_receipt(db_session, body["id"])
        assert len(statements) == 4
        assert all("JOIN products" not in statement for statement in statements)
        assert (result.goods_total, result.total_cost) == (70_000_000, 80_500_000)
        statements.clear()
        page = service.list_receipts(db_session, None, None, None, 50, 0)
        assert len(statements) == 2 and page.items[0].total_cost == 80_500_000
    finally:
        event.remove(connection, "before_cursor_execute", record)
    db_session.execute(
        text(
            "UPDATE receipt_lines SET unit_cost=NULL, unit_price_minor=NULL, goods_total=NULL "
            "WHERE id=:id"
        ),
        {"id": line_ids[0]},
    )
    result = auth_client.get(f"/api/receipts/{body['id']}").json()
    assert result["goods_total"] is None and result["total_cost"] is None
    assert auth_client.get("/api/receipts").json()["items"][0]["total_cost"] is None


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE receipts SET currency='KZT', exchange_rate=2, rate_date=NULL, rate_source=NULL",
        "UPDATE receipts SET rate_date=NULL",
        "UPDATE receipts SET rate_source=NULL",
        "UPDATE receipts SET rate_source='other'",
        "UPDATE receipts SET exchange_rate='NaN'",
        "UPDATE receipt_lines SET unit_price_minor=NULL",
        "UPDATE receipt_expenses SET is_vat_credit=true WHERE kind='delivery'",
        "UPDATE receipt_expenses SET revaluation_currency='USD' WHERE kind='delivery'",
        "UPDATE receipt_expenses SET revaluation_rate=2 WHERE kind='delivery'",
        "UPDATE receipt_expenses SET currency='CNY', exchange_rate=70, "
        "rate_source='nbk', rate_date=NULL",
        "UPDATE receipt_expenses SET rate_source='other'",
        "INSERT INTO receipt_expense_allocations (expense_id,receipt_line_id,amount_tiyn) "
        "SELECT expense_id,receipt_line_id,amount_tiyn FROM receipt_expense_allocations LIMIT 1",
    ],
)
def test_currency_database_constraints(auth_client, db_session, currency_payload, statement):
    post(auth_client, currency_payload)
    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.execute(text(statement))


@pytest.mark.parametrize("value", [-1, True, "100", 1.5, MAX_SALE_PRICE + 1])
def test_unit_price_minor_strict(auth_client, currency_payload, value):
    currency_payload["lines"][0]["unit_price_minor"] = value
    response = auth_client.post("/api/receipts", json=currency_payload)
    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "lines.0.unit_price_minor"


@pytest.mark.parametrize("value", [-1, True, "100", 1.5])
def test_manual_allocation_strict(auth_client, currency_payload, value):
    currency_payload["expenses"] = [
        {
            "kind": "bank",
            "amount_minor": 100,
            "allocation_method": "manual",
            "manual": [
                {"product_id": currency_payload["lines"][0]["product_id"], "amount_tiyn": value}
            ],
        }
    ]
    response = auth_client.post("/api/receipts", json=currency_payload)
    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "expenses.0.manual.0.amount_tiyn"


def test_vat_setting_not_in_settings_api(auth_client):
    assert "is_vat_payer" not in auth_client.get("/api/settings").json()

import uuid
from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy.orm import sessionmaker

from app.inventory.service import MovementIn, post_movements
from app.main import app
from app.rates import service as rates
from app.rates.models import ExchangeRate
from app.rates.router import get_rate_session_factory
from tests.factories import create_product, create_user


def at(days=0, hour=10):
    return datetime.combine(
        rates.today_local() - timedelta(days=days), time(hour), ZoneInfo("Asia/Almaty")
    ).isoformat()


@pytest.fixture
def rate_db(db_session):
    factory = sessionmaker(bind=db_session.connection(), join_transaction_mode="create_savepoint")
    app.dependency_overrides[get_rate_session_factory] = lambda: factory
    return factory


def get(client):
    r = client.get("/api/attention")
    assert r.status_code == 200, r.text
    return r.json()


def receive(client, pid, qty=100, cost=100000, days=120):
    r = client.post(
        "/api/receipts",
        json={
            "request_id": str(uuid.uuid4()),
            "received_at": at(days),
            "lines": [{"product_id": pid, "qty": qty, "unit_price_minor": cost}],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def sale(client, pid, qty=1, price=200000, days=1):
    r = client.post(
        "/api/sales",
        json={
            "request_id": str(uuid.uuid4()),
            "sold_at": at(days),
            "lines": [{"product_id": pid, "qty": qty, "unit_price": price}],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def returned(client, doc, qty, days=0):
    r = client.post(
        "/api/returns",
        json={
            "request_id": str(uuid.uuid4()),
            "sale_id": doc["id"],
            "returned_at": at(days, 11),
            "lines": [{"sale_line_id": doc["lines"][0]["id"], "qty": qty, "condition": "good"}],
        },
    )
    assert r.status_code == 201, r.text


@pytest.mark.parametrize(
    "price,kind,amount,suggested",
    [(1450000, "markup_drop", 28250000, 1733000), (900000, "below_replacement", 6250000, 1078000)],
)
@pytest.mark.parametrize("stale", [False, True])
def test_reference_7_8_and_old_rate(
    auth_client, db_session, rate_db, monkeypatch, price, kind, amount, suggested, stale
):
    day = rates.today_local() - timedelta(days=int(stale))
    db_session.add(ExchangeRate(currency="CNY", rate_date=day, rate=Decimal("85"), source="nbk"))
    db_session.flush()
    monkeypatch.setattr(
        rates, "_fetch_rates", lambda _: (_ for _ in ()).throw(OSError("Feed disabled"))
    )
    p = create_product(db_session, sale_price=price)
    other = create_product(db_session)
    r = auth_client.post(
        "/api/receipts",
        json={
            "request_id": str(uuid.uuid4()),
            "received_at": at(18),
            "currency": "CNY",
            "exchange_rate": "70",
            "rate_source": "manual",
            "lines": [
                {"product_id": p.id, "qty": 100, "unit_price_minor": 10000},
                {"product_id": other.id, "qty": 200, "unit_price_minor": 2500},
            ],
            "expenses": [
                {"kind": "delivery", "amount_minor": 10500000},
                {"kind": "customs_duty", "amount_minor": 5250000},
            ],
        },
    )
    assert r.status_code == 201, r.text
    body = get(auth_client)
    signal = next(s for s in body["signals"] if s["key"] == f"{kind}:product:{p.id}")
    assert signal["amount"] == amount
    assert signal["params"]["suggested_price"] == suggested
    assert signal["params"]["buy_today"] == 962500
    assert not any(
        s["kind"] == ("below_replacement" if kind == "markup_drop" else "markup_drop")
        and s["object"] == f"product:{p.id}"
        for s in body["signals"]
    )
    if kind == "markup_drop":
        assert [
            signal["params"][k]
            for k in ("markup_then", "markup_now", "drop_points", "price_to_keep_markup")
        ] == [80, 51, 29, 1732500]
    assert auth_client.get(f"/api/products/{p.id}/buy-today").json()["suggested_price"] == suggested
    if kind == "markup_drop":
        from tests.test_settings import FILLED

        auth_client.put("/api/settings", json={**FILLED, "attention_markup_drop_points": 29})
        assert not any(
            s["key"] == f"markup_drop:product:{p.id}" for s in get(auth_client)["signals"]
        )
        auth_client.put("/api/settings", json={**FILLED, "attention_markup_drop_points": 28})
        assert any(s["key"] == f"markup_drop:product:{p.id}" for s in get(auth_client)["signals"])
    if stale:
        warning = next(s for s in body["signals"] if s["key"] == "incomplete_data:rate:CNY")
        assert warning["amount"] == 100 * 805000 + 200 * 201250
        assert warning["params"]["rate"] == "85.0000"
        assert warning["params"]["rate_date"] == day.isoformat()
    p.is_archived = True
    db_session.flush()
    assert not any(
        s["object"] == f"product:{p.id}" and s["kind"] in ("below_replacement", "markup_drop")
        for s in get(auth_client)["signals"]
    )


def test_missing_average_old_rate_zero(auth_client, db_session, rate_db, monkeypatch):
    day = rates.today_local() - timedelta(days=1)
    db_session.add(ExchangeRate(currency="CNY", rate_date=day, rate=Decimal("85"), source="nbk"))
    p = create_product(db_session, sale_price=0)
    user = create_user(db_session)
    post_movements(db_session, [MovementIn(p.id, 10, "adjustment")], user.id)
    db_session.flush()
    r = auth_client.post(
        f"/api/products/{p.id}/price-quotes",
        json={
            "request_id": str(uuid.uuid4()),
            "currency": "CNY",
            "price_minor": 10000,
            "quoted_on": rates.today_local().isoformat(),
        },
    )
    assert r.status_code == 201, r.text
    monkeypatch.setattr(
        rates, "_fetch_rates", lambda _: (_ for _ in ()).throw(OSError("Feed disabled"))
    )
    p.is_archived = True
    db_session.flush()
    signals = {s["key"]: s for s in get(auth_client)["signals"]}
    assert signals["incomplete_data:stock"]["amount"] == 0
    assert signals["incomplete_data:rate:CNY"]["amount"] == 0
    assert signals["incomplete_data:rate:CNY"]["params"]["rate_date"] == day.isoformat()


@pytest.mark.parametrize(
    "age,sold,stock,price,minimum,amount,days_left,order,trigger",
    [
        (120, 24, 5, 200000, None, 1400000, 12, 19, "runway"),
        (39, 20, 6, 100000, None, 900000, 12, 24, "runway"),
        (120, 24, 0, 200000, None, 2400000, 0, 24, "runway"),
        (120, 6, 4, 200000, 5, 0, 40, 2, "min_qty"),
        (120, 24, 5, 0, None, 0, 12, 19, "runway"),
    ],
)
def test_runway_references(
    auth_client, db_session, age, sold, stock, price, minimum, amount, days_left, order, trigger
):
    p = create_product(db_session, sale_price=price)
    p.min_qty = minimum
    db_session.flush()
    receive(auth_client, p.id, sold + stock, 100000, age)
    sale(auth_client, p.id, sold, price)
    s = next(s for s in get(auth_client)["signals"] if s["kind"] == "running_out")
    assert s["amount"] == amount
    assert [s["params"][k] for k in ("days_left", "order_qty", "trigger")] == [
        days_left,
        order,
        trigger,
    ]
    p.is_archived = True
    db_session.flush()
    assert not any(s["kind"] == "running_out" for s in get(auth_client)["signals"])


@pytest.mark.parametrize("age,stock,pending", [(120, 12, False), (29, 5, True)])
def test_runway_exact_and_pending(auth_client, db_session, age, stock, pending):
    p = create_product(db_session, sale_price=200000)
    receive(auth_client, p.id, 24 + stock, 100000, age)
    sale(auth_client, p.id, 24)
    body = get(auth_client)
    assert not any(s["kind"] == "running_out" for s in body["signals"])
    rows = [s for s in body["pending"] if s["kind"] == "running_out"]
    assert bool(rows) == pending
    if pending:
        assert rows[0]["days_left"] == 1


def test_backdated_history_and_dismissal(auth_client, db_session, monkeypatch):
    p = create_product(db_session, sale_price=200000)
    receive(auth_client, p.id, 10, 500000, 120)
    key = f"frozen_stock:product:{p.id}"
    assert next(s for s in get(auth_client)["signals"] if s["key"] == key)["amount"] == 5000000
    today = rates.today_local()
    r = auth_client.post("/api/attention/hide", json={"key": key})
    assert r.status_code == 200
    assert any(s["key"] == key for s in get(auth_client)["hidden"])
    monkeypatch.setattr(rates, "today_local", lambda: today + timedelta(days=7))
    assert any(s["key"] == key for s in get(auth_client)["signals"])
    auth_client.post("/api/attention/hide", json={"key": key})
    assert auth_client.post("/api/attention/unhide", json={"key": key}).status_code == 200
    assert any(s["key"] == key for s in get(auth_client)["signals"])
    assert auth_client.post("/api/attention/unhide", json={"key": key}).status_code == 200


@pytest.mark.parametrize(
    "key",
    [
        "bad",
        "old_debt:product:1",
        "frozen_stock:pending",
        "incomplete_data:rate:KZT",
        "markup_drop:product:0",
    ],
)
def test_invalid_key(auth_client, key):
    r = auth_client.post("/api/attention/hide", json={"key": key})
    assert r.status_code == 422
    assert r.json()["errors"][0]["type"] == "attention_key_invalid"


def test_auth(client):
    assert client.get("/api/attention").status_code == 401
    for action in ("hide", "unhide"):
        assert (
            client.post(f"/api/attention/{action}", json={"key": "discounts:business"}).status_code
            == 401
        )


def test_loss_returns(auth_client, db_session):
    p = create_product(db_session, sale_price=100000)
    receive(auth_client, p.id, 10, 100000)
    doc = sale(auth_client, p.id, 3, 90000)
    returned(auth_client, doc, 1)
    s = next(s for s in get(auth_client)["signals"] if s["kind"] == "loss_sales")
    assert s["amount"] == 20000
    assert s["params"]["qty"] == 2


def test_unknown_sales_returns(auth_client, db_session):
    p = create_product(db_session, sale_price=100000)
    u = create_user(db_session)
    post_movements(db_session, [MovementIn(p.id, 20, "adjustment")], u.id)
    db_session.flush()
    old = sale(auth_client, p.id, 2, 100000, 40)
    doc = sale(auth_client, p.id, 3, 100000)
    returned(auth_client, doc, 1)
    returned(auth_client, old, 2)
    s = next(s for s in get(auth_client)["signals"] if s["key"] == "incomplete_data:sales")
    assert s["amount"] == 200000
    assert s["params"]["lines_count"] == 1
    assert [s["sale_id"] for s in s["params"]["sales"]] == [doc["id"]]
    returned(auth_client, doc, 2)
    assert not any(s["key"] == "incomplete_data:sales" for s in get(auth_client)["signals"])


@pytest.mark.parametrize(
    "field,low,high",
    [
        ("markup_drop_points", 1, 100),
        ("debt_days", 1, 365),
        ("frozen_days", 30, 365),
        ("runway_days", 1, 180),
        ("discount_percent", 1, 100),
        ("loss_percent", 1, 100),
    ],
)
def test_settings_thresholds(auth_client, field, low, high):
    from tests.test_settings import FILLED

    name = "attention_" + field
    for value in (None, True, 1.5, "10", low - 1, high + 1):
        assert auth_client.put("/api/settings", json={**FILLED, name: value}).status_code == 422
    for value in (low, high):
        r = auth_client.put("/api/settings", json={**FILLED, name: value})
        assert r.status_code == 200, r.text
        assert r.json()[name] == value
    payload = {k: v for k, v in FILLED.items() if not k.startswith("attention_")}
    assert auth_client.put("/api/settings", json=payload).json()[name] == high


def test_opening_date_reports(auth_client, db_session):
    from app.demo import _historical_adjustment
    from app.settings.models import BusinessSettings
    from tests.test_settings import FILLED

    p = create_product(db_session, sale_price=200000)
    u = create_user(db_session)
    receive(auth_client, p.id, 10, 100000, 18)
    for days, qty in [(17, -2), (16, 1), (0, -1)]:
        _historical_adjustment(
            db_session,
            MovementIn(p.id, qty, "adjustment", note="Opening"),
            u.id,
            datetime.fromisoformat(at(days)),
        )
    db_session.flush()
    opening = (rates.today_local() - timedelta(days=16)).isoformat()
    r = auth_client.put("/api/settings", json={**FILLED, "opening_balance_date": opening})
    assert r.status_code == 200, r.text
    params = {
        "from": (rates.today_local() - timedelta(days=20)).isoformat(),
        "to": rates.today_local().isoformat(),
    }
    summary = auth_client.get("/api/reports/summary", params=params).json()
    assert summary["write_off_value"] == 100000
    assert summary["write_off_count"] == 1
    assert summary["surplus_value"] == 0
    assert summary["profit_after_expenses"] == -100000
    for direction, count in [("minus", 1), ("plus", 0)]:
        assert (
            auth_client.get(
                "/api/reports/adjustments", params={**params, "direction": direction}
            ).json()["total"]
            == count
        )
    assert (
        next(s for s in get(auth_client)["signals"] if s["kind"] == "defects_write_offs")["amount"]
        == 100000
    )
    payload = {k: v for k, v in FILLED.items() if k != "opening_balance_date"}
    assert auth_client.put("/api/settings", json=payload).json()["opening_balance_date"] == opening
    assert (
        auth_client.put("/api/settings", json={**payload, "opening_balance_date": None}).json()[
            "opening_balance_date"
        ]
        is None
    )
    future = (rates.today_local() + timedelta(days=1)).isoformat()
    r = auth_client.put("/api/settings", json={**payload, "opening_balance_date": future})
    assert r.status_code == 422
    assert r.json()["errors"][0]["type"] == "opening_date_in_future"
    sale(auth_client, p.id, days=1)
    r = auth_client.put(
        "/api/settings", json={**payload, "opening_balance_date": rates.today_local().isoformat()}
    )
    assert r.status_code == 422
    assert r.json()["errors"][0]["type"] == "opening_date_after_sales"
    assert (
        r.json()["errors"][0]["params"]["first_sale_date"]
        == (rates.today_local() - timedelta(days=1)).isoformat()
    )
    assert db_session.get(BusinessSettings, 1).opening_balance_date is None


def test_constant_queries(auth_client, db_session, monkeypatch):
    from unittest.mock import Mock

    from sqlalchemy import event

    from app.attention import service as attention_service
    from app.demo import _historical_adjustment
    from tests.factories import create_customer

    evaluate = Mock(wraps=attention_service.evaluate_products)
    monkeypatch.setattr(attention_service, "evaluate_products", evaluate)

    counts = []
    for size in (1, 10):
        for _ in range(size):
            p = create_product(db_session, sale_price=200000)
            receive(auth_client, p.id, 10)
            sale(auth_client, p.id)
            create_customer(db_session)
            user = create_user(db_session)
            _historical_adjustment(
                db_session,
                MovementIn(p.id, -1, "adjustment"),
                user.id,
                datetime.fromisoformat(at()),
            )
            db_session.flush()
        db_session.expunge_all()
        evaluate.reset_mock()
        statements = []
        conn = db_session.connection()

        def record(
            conn, cursor, statement, parameters, context, executemany, statements=statements
        ):
            statements.append(statement)

        event.listen(conn, "before_cursor_execute", record)
        try:
            get(auth_client)
        finally:
            event.remove(conn, "before_cursor_execute", record)
        assert evaluate.call_count == 1
        counts.append(len(statements))
    assert counts[0] == counts[1]


@pytest.mark.parametrize(
    "discount,profit,expected",
    [(1000000, 10000000, False), (1000001, 10000000, True), (100, 0, True)],
)
def test_discount_boundary(auth_client, db_session, discount, profit, expected):
    price = 10000000
    p = create_product(db_session, sale_price=price + discount)
    receive(auth_client, p.id, 2, price - profit)
    sale(auth_client, p.id, 1, price)
    rows = [s for s in get(auth_client)["signals"] if s["kind"] == "discounts"]
    assert bool(rows) == expected
    if rows:
        assert rows[0]["amount"] == discount
    from tests.test_settings import FILLED

    auth_client.put("/api/settings", json={**FILLED, "attention_discount_percent": 20})
    assert not any(s["kind"] == "discounts" for s in get(auth_client)["signals"]) or profit == 0


@pytest.mark.parametrize("writeoff,expected", [(1500000, False), (1500001, True)])
def test_losses_boundary(auth_client, db_session, writeoff, expected):
    from app.demo import _historical_adjustment

    p = create_product(db_session, sale_price=1000000)
    receive(auth_client, p.id, 101, 1000000)
    doc = sale(auth_client, p.id, 101, 1000000)
    r = auth_client.post(
        "/api/returns",
        json={
            "request_id": str(uuid.uuid4()),
            "sale_id": doc["id"],
            "returned_at": at(0, 11),
            "lines": [{"sale_line_id": doc["lines"][0]["id"], "qty": 1, "condition": "defective"}],
        },
    )
    assert r.status_code == 201, r.text
    u = create_user(db_session)
    q = create_product(db_session)
    receive(auth_client, q.id, 1, writeoff)
    _historical_adjustment(
        db_session, MovementIn(q.id, -1, "adjustment"), u.id, datetime.fromisoformat(at())
    )
    extra = create_product(db_session)
    _historical_adjustment(
        db_session,
        MovementIn(extra.id, 1, "adjustment", unit_cost=500000),
        u.id,
        datetime.fromisoformat(at()),
    )
    db_session.flush()
    rows = [s for s in get(auth_client)["signals"] if s["kind"] == "defects_write_offs"]
    assert bool(rows) == expected
    if rows:
        assert rows[0]["amount"] == 2000001
        assert rows[0]["params"]["revenue"] == 100000000
    from tests.test_settings import FILLED

    auth_client.put("/api/settings", json={**FILLED, "attention_loss_percent": 3})
    assert not any(s["kind"] == "defects_write_offs" for s in get(auth_client)["signals"])


def test_mixup_no_loss(auth_client, db_session):
    from app.demo import _historical_adjustment

    p = create_product(db_session)
    receive(auth_client, p.id, 2, 500000)
    u = create_user(db_session)
    for qty in (-1, 1):
        _historical_adjustment(
            db_session, MovementIn(p.id, qty, "adjustment"), u.id, datetime.fromisoformat(at())
        )
    db_session.flush()
    assert not any(s["kind"] == "defects_write_offs" for s in get(auth_client)["signals"])


@pytest.mark.parametrize(
    "age,last,expected,left", [(120, 90, True, None), (120, 89, False, None), (89, None, False, 1)]
)
def test_frozen_boundary(auth_client, db_session, age, last, expected, left):
    p = create_product(db_session, sale_price=600000)
    receive(auth_client, p.id, 11 if last else 10, 500000, age)
    if last:
        sale(auth_client, p.id, 1, 600000, last)
    body = get(auth_client)
    rows = [s for s in body["signals"] if s["kind"] == "frozen_stock"]
    assert bool(rows) == expected
    if rows:
        assert rows[0]["amount"] == 5000000
        assert rows[0]["params"]["days_without_sales"] == 90
    if left:
        assert next(s for s in body["pending"] if s["kind"] == "frozen_stock")["days_left"] == left


@pytest.mark.parametrize("age,expected", [(30, False), (31, True), (45, True)])
def test_old_debt_fifo(auth_client, db_session, age, expected):
    from tests.factories import create_customer

    p = create_product(db_session, sale_price=5000000)
    receive(auth_client, p.id, 10, 100000)
    c = create_customer(db_session)
    for days, price in [(age, 5000000), (10, 3000000)]:
        r = auth_client.post(
            "/api/sales",
            json={
                "request_id": str(uuid.uuid4()),
                "customer_id": c.id,
                "paid_amount": 0,
                "sold_at": at(days),
                "lines": [{"product_id": p.id, "qty": 1, "unit_price": price}],
            },
        )
        assert r.status_code == 201, r.text
    r = auth_client.post(
        "/api/payments",
        json={
            "request_id": str(uuid.uuid4()),
            "customer_id": c.id,
            "amount": 2000000,
            "payment_method": "cash",
            "paid_at": at(),
        },
    )
    assert r.status_code == 201, r.text
    rows = [s for s in get(auth_client)["signals"] if s["kind"] == "old_debt"]
    assert bool(rows) == expected
    if rows:
        assert rows[0]["amount"] == 3000000
        assert rows[0]["params"]["total_debt"] == 6000000
        assert rows[0]["params"]["age_days"] == age
        assert rows[0]["params"]["oldest_kind"] == "sale"
    from tests.test_settings import FILLED

    auth_client.put("/api/settings", json={**FILLED, "attention_debt_days": age})
    assert not any(s["kind"] == "old_debt" for s in get(auth_client)["signals"])
    auth_client.put("/api/settings", json={**FILLED, "attention_debt_days": age - 1})
    assert any(s["kind"] == "old_debt" for s in get(auth_client)["signals"])


def test_opening_almaty_midnight(auth_client, db_session):
    from app.demo import _historical_adjustment
    from tests.test_settings import FILLED

    p = create_product(db_session)
    receive(auth_client, p.id, 10, 100000, 18)
    u = create_user(db_session)
    day = rates.today_local() - timedelta(days=16)
    for moment in (
        datetime.combine(day, time(23, 30), ZoneInfo("Asia/Almaty")),
        datetime.combine(day + timedelta(days=1), time(0, 30), ZoneInfo("Asia/Almaty")),
    ):
        _historical_adjustment(db_session, MovementIn(p.id, -1, "adjustment"), u.id, moment)
    db_session.flush()
    assert (
        auth_client.put(
            "/api/settings", json={**FILLED, "opening_balance_date": day.isoformat()}
        ).status_code
        == 200
    )
    params = {"from": day.isoformat(), "to": (day + timedelta(days=1)).isoformat()}
    body = auth_client.get("/api/reports/summary", params=params).json()
    assert body["write_off_value"] == 100000
    rows = auth_client.get(
        "/api/reports/adjustments", params={**params, "direction": "minus"}
    ).json()
    assert rows["total"] == 1
    assert (
        datetime.fromisoformat(rows["items"][0]["created_at"])
        .astimezone(ZoneInfo("Asia/Almaty"))
        .hour
        == 0
    )


def test_archive_and_order(auth_client, db_session):
    from app.attention.schemas import KINDS

    p = create_product(db_session, sale_price=100000)
    receive(auth_client, p.id, 10, 200000)
    body = get(auth_client)
    assert any(s["kind"] == "below_replacement" for s in body["signals"])
    p.is_archived = True
    db_session.flush()
    signals = get(auth_client)["signals"]
    assert not any(
        s["kind"] in ("below_replacement", "markup_drop", "running_out") for s in signals
    )
    assert any(s["kind"] == "frozen_stock" for s in signals)
    p2 = create_product(db_session, sale_price=200000)
    receive(auth_client, p2.id, 10, 200000)
    p3 = create_product(db_session, sale_price=200000)
    receive(auth_client, p3.id, 10, 400000)
    signals = get(auth_client)["signals"]
    assert signals == sorted(
        signals, key=lambda s: (-s["amount"], KINDS.index(s["kind"]), s["key"])
    )
    assert [
        s["key"] for s in signals if s["kind"] == "frozen_stock" and s["amount"] == 2000000
    ] == sorted([f"frozen_stock:product:{p.id}", f"frozen_stock:product:{p2.id}"])
    assert [s["kind"] for s in signals if s["amount"] == 2000000] == [
        "below_replacement",
        "frozen_stock",
        "frozen_stock",
    ]


def test_hide_renews_and_amount_independent(auth_client, db_session, monkeypatch):
    p = create_product(db_session, sale_price=100000)
    receive(auth_client, p.id, 10, 200000)
    key = f"below_replacement:product:{p.id}"
    today = rates.today_local()
    assert auth_client.post("/api/attention/hide", json={"key": key}).status_code == 200
    p.sale_price = 150000
    db_session.flush()
    assert next(s for s in get(auth_client)["hidden"] if s["key"] == key)["amount"] == 500000
    monkeypatch.setattr(rates, "today_local", lambda: today + timedelta(days=3))
    r = auth_client.post("/api/attention/hide", json={"key": key})
    assert r.json()["hidden_until"] == (today + timedelta(days=10)).isoformat()
    monkeypatch.setattr(rates, "today_local", lambda: today + timedelta(days=7))
    assert any(s["key"] == key for s in get(auth_client)["hidden"])


def test_suggested_price_below_half_interval(auth_client, db_session):
    p = create_product(db_session, sale_price=2000)
    r = auth_client.post(
        f"/api/products/{p.id}/price-quotes",
        json={
            "request_id": str(uuid.uuid4()),
            "currency": "KZT",
            "price_minor": 1001,
            "quoted_on": rates.today_local().isoformat(),
        },
    )
    assert r.status_code == 201, r.text
    assert auth_client.get(f"/api/products/{p.id}/buy-today").json()["suggested_price"] == 2000


def test_changed_runway_threshold(auth_client, db_session):
    from tests.test_settings import FILLED

    p = create_product(db_session, sale_price=200000)
    receive(auth_client, p.id, 29)
    sale(auth_client, p.id, 24)
    for threshold, expected in [(12, False), (13, True)]:
        assert (
            auth_client.put(
                "/api/settings", json={**FILLED, "attention_runway_days": threshold}
            ).status_code
            == 200
        )
        assert any(s["kind"] == "running_out" for s in get(auth_client)["signals"]) == expected


def test_changed_frozen_threshold(auth_client, db_session):
    from tests.test_settings import FILLED

    p = create_product(db_session, sale_price=200000)
    receive(auth_client, p.id, 11)
    sale(auth_client, p.id, 1, 200000, 90)
    for threshold, expected in [(91, False), (90, True)]:
        assert (
            auth_client.put(
                "/api/settings", json={**FILLED, "attention_frozen_days": threshold}
            ).status_code
            == 200
        )
        assert any(s["kind"] == "frozen_stock" for s in get(auth_client)["signals"]) == expected

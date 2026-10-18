"""Receipt preparation, warning confirmation and compatibility contracts (26a-2)."""

import uuid
from datetime import date
from decimal import Decimal
from unittest.mock import Mock

import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import OperationalError

from app.catalog.models import Product
from app.errors import RateDateInFutureError, RateNotFoundError
from app.inventory.models import StockBalance, StockMovement
from app.numbering import DocumentCounter
from app.rates.schemas import RateOut
from app.receipts import service
from app.receipts.models import Receipt, ReceiptExpense, ReceiptExpenseAllocation, ReceiptLine
from app.schema_types import MAX_MONEY
from app.settings.models import BusinessSettings
from tests.factories import create_product

DAY = date(2026, 10, 14)
AT = "2026-10-14T12:00:00Z"


@pytest.fixture
def comparison(monkeypatch):
    calls = []

    def compare(currency, day, *, session_factory):
        calls.append((currency, day, session_factory))
        return RateOut(
            currency=currency, requested_date=day, rate_date=day, rate=Decimal("70"), exact=True
        )

    monkeypatch.setattr(service, "get_rate", compare)
    return calls


@pytest.fixture
def payload(db_session):
    products = [create_product(db_session, sale_price=1_450_000) for _ in range(2)]
    return {
        "request_id": str(uuid.uuid4()),
        "received_at": AT,
        "currency": "CNY",
        "exchange_rate": "70",
        "rate_source": "manual",
        "lines": [
            {"product_id": p.id, "qty": qty, "unit_price_minor": price}
            for p, qty, price in zip(products, [100, 200], [10_000, 2500], strict=True)
        ],
        "expenses": [
            {"kind": "delivery", "amount_minor": 10_500_000},
            {"kind": "customs_duty", "amount_minor": 5_250_000},
        ],
    }


def preview(client, payload):
    response = client.post("/api/receipts/preview", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def state(db):
    models = (
        Receipt,
        ReceiptLine,
        ReceiptExpense,
        ReceiptExpenseAllocation,
        StockMovement,
        StockBalance,
        DocumentCounter,
        BusinessSettings,
    )
    return {
        model.__tablename__: db.execute(
            select(model.__table__).order_by(*model.__table__.primary_key)
        ).all()
        for model in models
    }


def kzt(pid, cost, **extra):
    return {
        "request_id": str(uuid.uuid4()),
        "received_at": AT,
        "lines": [{"product_id": pid, "qty": 1, "unit_price_minor": cost}],
        **extra,
    }


@pytest.mark.parametrize(
    "reference,vat,expected",
    [
        (1, False, [805_000, 201_250]),
        (3, False, [871_667, 217_917]),
        (4, True, [805_000, 201_250]),
    ],
)
def test_preview_references_match_post_and_write_nothing(
    auth_client, db_session, payload, comparison, monkeypatch, reference, vat, expected
):
    db_session.get(BusinessSettings, 1).is_vat_payer = vat
    db_session.flush()
    if reference != 1:
        payload["expenses"].append({"kind": "import_vat", "amount_minor": 10_000_000})
    before = state(db_session)
    commit = Mock(wraps=db_session.commit)
    monkeypatch.setattr(db_session, "commit", commit)
    with monkeypatch.context() as checks:
        for name in ("lock_request_id", "next_number", "post_movements"):
            checks.setattr(service, name, Mock(side_effect=AssertionError(name)))
        result = preview(auth_client, {k: v for k, v in payload.items() if k != "request_id"})
    assert state(db_session) == before
    commit.assert_not_called()
    assert [line["unit_cost"] for line in result["lines"]] == expected
    assert result["rate_date"] == DAY.isoformat() and result["exchange_rate"] == "70.0000"
    assert result["vat_payer"] == vat
    posted = auth_client.post("/api/receipts", json=payload)
    assert posted.status_code == 201, posted.text
    stored = posted.json()
    for key in ("goods_total", "expenses_total", "vat_credit_total", "total_cost"):
        assert result[key] == stored[key]
    for calculated, saved in zip(result["lines"], stored["lines"], strict=True):
        assert {k: calculated[k] for k in saved} == saved
    for index, (calculated, saved) in enumerate(
        zip(result["expenses"], stored["expenses"], strict=True)
    ):
        assert calculated["index"] == index
        for key in ("amount_tiyn", "is_vat_credit", "revaluation_currency", "revaluation_rate"):
            assert calculated[key] == saved[key]
        assert calculated["allocations"] == [
            {"product_id": a["product_id"], "amount_tiyn": a["amount_tiyn"]}
            for a in saved["allocations"]
        ]


def test_preview_does_not_restore_missing_settings(auth_client, db_session, monkeypatch):
    pid = create_product(db_session).id
    db_session.execute(delete(BusinessSettings))
    commit = Mock(wraps=db_session.commit)
    monkeypatch.setattr(db_session, "commit", commit)
    assert preview(auth_client, kzt(pid, 1))["vat_payer"] is False
    assert db_session.scalar(select(BusinessSettings)) is None
    commit.assert_not_called()


@pytest.mark.parametrize(
    "cost,price,expected",
    [
        (962_500, 1_450_000, 51),
        (805_000, 1_450_000, 80),
        (100_000, 50_000, -50),
        (100_000, 49_500, -51),
        (0, 0, None),
    ],
)
def test_reference_7_markup(auth_client, db_session, cost, price, expected):
    pid = create_product(db_session, sale_price=price).id
    assert preview(auth_client, kzt(pid, cost))["lines"][0]["markup_percent"] == expected


@pytest.mark.parametrize("target", ["receipt", "expense"])
@pytest.mark.parametrize(
    "rate,expected",
    [
        ("77.0000", False),
        ("77.0001", True),
        ("63.0000", False),
        ("62.9999", True),
    ],
)
def test_rate_warning_boundaries(auth_client, payload, comparison, target, rate, expected):
    rate_input = payload if target == "receipt" else payload["expenses"][0]
    rate_input.update(currency="CNY", exchange_rate=rate, rate_source="manual")
    warnings = [
        w for w in preview(auth_client, payload)["warnings"] if w["code"] == "rate_deviation"
    ]
    assert bool(warnings) == expected
    if expected:
        warning = warnings[0]
        index = "-" if target == "receipt" else "0"
        assert warning["key"] == f"rate_deviation:{target}:{index}:CNY:{rate}:70.0000"
        assert warning["params"] == {
            "target": target,
            "index": None if target == "receipt" else 0,
            "currency": "CNY",
            "rate": rate,
            "nbk_rate": "70.0000",
            "nbk_rate_date": DAY.isoformat(),
            "nbk_exact": True,
            "percent": 10,
        }


def test_fallback_warning_has_actual_date_and_exact_flag(auth_client, payload, monkeypatch):
    monkeypatch.setattr(
        service,
        "get_rate",
        lambda *a, **k: RateOut(
            currency="CNY",
            requested_date=DAY,
            rate_date=date(2026, 10, 12),
            rate=Decimal("70"),
            exact=False,
        ),
    )
    payload["exchange_rate"] = "80"
    params = preview(auth_client, payload)["warnings"][0]["params"]
    assert params["nbk_rate_date"] == "2026-10-12" and params["nbk_exact"] is False
    assert params["percent"] == 14


def test_rate_warning_uses_configured_threshold_and_half_up_percent(
    auth_client, db_session, payload, comparison
):
    settings = db_session.get(BusinessSettings, 1)
    settings.rate_warning_percent = 25
    payload["exchange_rate"] = "84.0000"
    db_session.flush()
    assert preview(auth_client, payload)["warnings"] == []
    settings.rate_warning_percent = 19
    db_session.flush()
    assert preview(auth_client, payload)["warnings"][0]["params"]["percent"] == 20
    settings.rate_warning_percent = 10
    payload["exchange_rate"] = "77.3500"
    db_session.flush()
    assert preview(auth_client, payload)["warnings"][0]["params"]["percent"] == 11


@pytest.mark.parametrize(
    "cost,expected",
    [
        (1_610_000, True),
        (1_609_999, False),
        (402_500, True),
        (402_501, False),
    ],
)
def test_cost_jump_boundaries(auth_client, db_session, cost, expected):
    pid = create_product(db_session, sale_price=10_000_000).id
    first = auth_client.post("/api/receipts", json=kzt(pid, 805_000)).json()
    result = preview(auth_client, kzt(pid, cost))
    assert result["lines"][0]["previous_cost"] == 805_000
    assert bool(result["warnings"]) == expected
    if expected:
        warning = result["warnings"][0]
        assert warning["key"] == f"cost_jump:{pid}:{cost}:805000"
        assert warning["params"]["previous_received_at"] == first["received_at"]


@pytest.mark.parametrize("previous", [None, 0])
def test_cost_jump_without_positive_previous_cost(auth_client, db_session, previous):
    pid = create_product(db_session, sale_price=10_000_000).id
    if previous is not None:
        assert auth_client.post("/api/receipts", json=kzt(pid, previous)).status_code == 201
    assert preview(auth_client, kzt(pid, 100))["warnings"] == []


@pytest.mark.parametrize("cost,price,expected", [(100, 100, True), (99, 100, False), (0, 0, True)])
def test_cost_not_below_price_boundary(auth_client, db_session, cost, price, expected):
    pid = create_product(db_session, sale_price=price).id
    warnings = preview(auth_client, kzt(pid, cost))["warnings"]
    assert bool(warnings) == expected
    if expected:
        assert warnings[0]["key"] == f"cost_not_below_price:{pid}:{cost}:{price}"


def test_warning_order_input_lines_and_expense_indices(
    auth_client, db_session, payload, comparison
):
    for line in payload["lines"]:
        pid = line["product_id"]
        assert auth_client.post("/api/receipts", json=kzt(pid, 1)).status_code == 201
        db_session.get(Product, pid).sale_price = 1
    db_session.flush()
    payload["lines"].reverse()
    payload["exchange_rate"] = "80"
    payload["expenses"] += [
        {
            "kind": "bank",
            "amount_minor": 1,
            "currency": cur,
            "rate_source": "manual",
            "exchange_rate": "90",
        }
        for cur in ("CNY", "USD")
    ]
    warnings = preview(auth_client, payload)["warnings"]
    assert [w["code"] for w in warnings] == [
        "rate_deviation",
        "rate_deviation",
        "rate_deviation",
        "cost_jump",
        "cost_not_below_price",
        "cost_jump",
        "cost_not_below_price",
    ]
    assert [w["params"]["index"] for w in warnings[:3]] == [None, 2, 3]
    assert [w["params"]["product_id"] for w in warnings[3:]] == [
        pid for line in payload["lines"] for pid in [line["product_id"]] * 2
    ]


def test_warning_confirmation_requires_all_current_keys(
    auth_client, db_session, payload, comparison
):
    payload["exchange_rate"] = "80"
    pid = payload["lines"][0]["product_id"]
    db_session.get(Product, pid).sale_price = 0
    db_session.flush()
    warnings = preview(auth_client, payload)["warnings"]
    assert len(warnings) == 2
    before = state(db_session)
    for confirmed in ([], [warnings[0]["key"]]):
        response = auth_client.post(
            "/api/receipts", json={**payload, "confirmed_warnings": confirmed}
        )
        assert response.status_code == 409
        assert response.json()["code"] == "receipt_warnings"
        assert response.json()["params"] == {"warnings": warnings}
        assert state(db_session) == before
    response = auth_client.post(
        "/api/receipts",
        json={
            **payload,
            "confirmed_warnings": [w["key"] for w in warnings] + ["extra:key"],
        },
    )
    assert response.status_code == 201, response.text


@pytest.mark.parametrize("change", ["rate", "cost", "sale_price"])
def test_changed_numbers_require_new_keys(auth_client, db_session, payload, comparison, change):
    payload["exchange_rate"] = "80"
    pid = payload["lines"][0]["product_id"]
    db_session.get(Product, pid).sale_price = 0
    db_session.flush()
    old_keys = [w["key"] for w in preview(auth_client, payload)["warnings"]]
    if change == "rate":
        payload["exchange_rate"] = "81"
    elif change == "cost":
        payload["lines"][0]["unit_price_minor"] += 1
    else:
        db_session.get(Product, pid).sale_price = 1
        db_session.flush()
    response = auth_client.post("/api/receipts", json={**payload, "confirmed_warnings": old_keys})
    assert response.status_code == 409 and response.json()["code"] == "receipt_warnings"
    assert any(w["key"] not in old_keys for w in response.json()["params"]["warnings"])


@pytest.mark.parametrize("confirmation", ["absent", None])
def test_legacy_post_ignores_warnings(auth_client, payload, comparison, confirmation):
    payload["exchange_rate"] = "80"
    if confirmation != "absent":
        payload["confirmed_warnings"] = confirmation
    assert preview(auth_client, payload)["warnings"]
    assert auth_client.post("/api/receipts", json=payload).status_code == 201


def test_replay_before_preparation_after_changed_threshold_and_price(
    auth_client, db_session, payload, comparison, monkeypatch
):
    payload["exchange_rate"] = "80"
    first = auth_client.post("/api/receipts", json=payload)
    assert first.status_code == 201
    db_session.get(BusinessSettings, 1).rate_warning_percent = 1
    for line in payload["lines"]:
        db_session.get(Product, line["product_id"]).sale_price = 0
    db_session.flush()
    for name in ("_prepare_receipt", "get_rate", "lock_request_id"):
        monkeypatch.setattr(service, name, Mock(side_effect=AssertionError(name)))
    for confirmed in (None, []):
        response = auth_client.post(
            "/api/receipts", json={**payload, "confirmed_warnings": confirmed}
        )
        assert response.status_code == 200 and response.json() == first.json()


def test_rate_calls_only_manual_and_once_per_currency(auth_client, payload, comparison, db_session):
    pid = payload["lines"][0]["product_id"]
    assert auth_client.post("/api/receipts", json=kzt(pid, 1)).status_code == 201
    assert comparison == []
    from app.rates.models import ExchangeRate

    db_session.add(ExchangeRate(rate_date=DAY, currency="CNY", rate=Decimal("70"), source="nbk"))
    db_session.flush()
    nbk = {**payload, "rate_source": "nbk", "rate_date": DAY.isoformat()}
    assert auth_client.post("/api/receipts", json=nbk).status_code == 201
    assert comparison == []
    payload["request_id"] = str(uuid.uuid4())
    payload["expenses"] += [
        {
            "kind": "bank",
            "amount_minor": 1,
            "currency": cur,
            "exchange_rate": "80",
            "rate_source": "manual",
        }
        for cur in ("CNY", "CNY", "USD", "USD")
    ]
    assert auth_client.post("/api/receipts", json=payload).status_code == 201
    assert [(cur, day) for cur, day, _ in comparison] == [("CNY", DAY), ("USD", DAY)]


@pytest.mark.parametrize("error", [RateNotFoundError, RateDateInFutureError])
def test_rate_app_error_is_cached_and_does_not_block_post(auth_client, payload, monkeypatch, error):
    compare = Mock(side_effect=error())
    monkeypatch.setattr(service, "get_rate", compare)
    payload["exchange_rate"] = "80"
    payload["expenses"].append(
        {
            "kind": "bank",
            "amount_minor": 1,
            "currency": "CNY",
            "exchange_rate": "90",
            "rate_source": "manual",
        }
    )
    assert not any(w["code"] == "rate_deviation" for w in preview(auth_client, payload)["warnings"])
    assert compare.call_count == 1
    assert auth_client.post("/api/receipts", json=payload).status_code == 201
    assert compare.call_count == 2


def test_rate_database_error_is_not_swallowed(auth_client, payload, monkeypatch):
    error = OperationalError("database failed", {}, Exception("failed"))
    monkeypatch.setattr(service, "get_rate", Mock(side_effect=error))
    with pytest.raises(OperationalError) as raised:
        auth_client.post("/api/receipts", json=payload)
    assert raised.value is error


@pytest.mark.parametrize("case", ["format", "nbk", "zero_weight", "manual_sum", "large"])
def test_preview_same_422_as_post(auth_client, db_session, payload, comparison, case):
    if case == "format":
        payload["exchange_rate"] = "70.00001"
    elif case == "nbk":
        payload.update(rate_source="nbk", rate_date=DAY.isoformat())
    elif case == "zero_weight":
        for line in payload["lines"]:
            line["unit_price_minor"] = 0
    elif case == "manual_sum":
        payload["expenses"] = [
            {
                "kind": "bank",
                "amount_minor": 100,
                "allocation_method": "manual",
                "manual": [{"product_id": payload["lines"][0]["product_id"], "amount_tiyn": 99}],
            }
        ]
    else:
        payload["expenses"] = [
            {
                "kind": "bank",
                "amount_minor": MAX_MONEY,
                "currency": "USD",
                "exchange_rate": "2",
                "rate_source": "manual",
            }
        ]
    before = state(db_session)
    a = auth_client.post("/api/receipts/preview", json=payload)
    b = auth_client.post("/api/receipts", json=payload)
    assert a.status_code == b.status_code == 422
    assert a.json() == b.json()
    assert state(db_session) == before


@pytest.mark.parametrize("method", ["amount", "quantity", "selected", "manual"])
def test_explicit_null_unused_expense_targets(auth_client, payload, comparison, method):
    expense = {
        "kind": "bank",
        "amount_minor": 100,
        "allocation_method": method,
        "product_ids": None,
        "manual": None,
    }
    if method == "selected":
        expense["product_ids"] = [payload["lines"][0]["product_id"]]
    elif method == "manual":
        expense["manual"] = [{"product_id": payload["lines"][0]["product_id"], "amount_tiyn": 100}]
    payload["expenses"] = [expense]
    preview(auth_client, payload)
    assert auth_client.post("/api/receipts", json=payload).status_code == 201


@pytest.mark.parametrize("confirmed", [["x"] * 101, ["x" * 201], [1]])
def test_confirmation_limits(auth_client, db_session, confirmed):
    pid = create_product(db_session).id
    assert (
        auth_client.post(
            "/api/receipts", json=kzt(pid, 1, confirmed_warnings=confirmed)
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    "path,method", [("/api/receipts/preview", "post"), ("/api/receipts/defaults", "get")]
)
def test_new_receipt_endpoints_require_auth(client, path, method):
    assert client.request(method, path, json={}).status_code == 401

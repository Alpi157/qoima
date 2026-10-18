"""Local demo-only walkthrough: NBK cache, preview, warning confirmation and replay.

Run from backend: DEMO_PASSWORD=... uv run python ../scripts/check_receipt_26a2.py
Start `python -m app.demo serve --port 8011` first. No external HTTP is used.
"""

import json
import os
import sys
import uuid
from datetime import date
from decimal import Decimal
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.dialects.postgresql import insert  # noqa: E402

from app import models  # noqa: E402, F401
from app.config import get_settings  # noqa: E402
from app.demo import demo_database_url  # noqa: E402
from app.rates.models import ExchangeRate  # noqa: E402


def main() -> None:
    engine = create_engine(demo_database_url(get_settings().database_url))
    assert engine.url.database == "qoima_demo"
    assert engine.url.host in ("localhost", "127.0.0.1", "::1"), "Local PostgreSQL only"
    day = date(2026, 10, 14)
    with engine.begin() as db:
        db.execute(
            insert(ExchangeRate)
            .values(rate_date=day, currency="CNY", rate=Decimal("70.0000"), source="nbk")
            .on_conflict_do_nothing()
        )
        assert db.scalar(
            select(ExchangeRate.rate).where(
                ExchangeRate.rate_date == day, ExchangeRate.currency == "CNY"
            )
        ) == Decimal("70")

    opener = build_opener(HTTPCookieProcessor(CookieJar()))

    def call(method, path, body=None):
        request = Request(
            "http://localhost:8011/api" + path,
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json"},
        )
        try:
            with opener.open(request, timeout=10) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.loads(error.read())

    status, body = call(
        "POST",
        "/auth/login",
        {
            "username": "demo",
            "password": os.environ["DEMO_PASSWORD"],
        },
    )
    assert status == 200, body
    _, settings = call("GET", "/settings")
    saved_settings = {
        key: settings[key]
        for key in (
            "seller_name",
            "seller_iin_bin",
            "responsible_person",
            "released_by_name",
            "chief_accountant",
            "is_vat_payer",
            "rate_warning_percent",
        )
    }
    status, body = call(
        "PUT",
        "/settings",
        {
            **saved_settings,
            "is_vat_payer": False,
            "rate_warning_percent": 10,
        },
    )
    assert status == 200, body
    try:
        products = []
        for index in range(2):
            status, product = call(
                "POST",
                "/products",
                {
                    "article": f"LOCAL-26A2-{uuid.uuid4().hex[:12]}-{index}",
                    "name": f"Локальный эталон 26a-2, строка {index + 1}",
                    "sale_price": 1_450_000,
                },
            )
            assert status == 201, product
            products.append(product["id"])
        payload = {
            "request_id": str(uuid.uuid4()),
            "received_at": "2026-10-14T12:00:00Z",
            "currency": "CNY",
            "exchange_rate": "77.0001",
            "rate_source": "manual",
            "supplier": "LOCAL-26A2",
            "confirmed_warnings": [],
            "lines": [
                {"product_id": pid, "qty": qty, "unit_price_minor": price}
                for pid, qty, price in zip(products, [100, 200], [10_000, 2500], strict=True)
            ],
            "expenses": [
                {"kind": "delivery", "amount_minor": 10_500_000},
                {"kind": "customs_duty", "amount_minor": 5_250_000},
            ],
        }
        status, calculated = call("POST", "/receipts/preview", payload)
        assert status == 200, calculated
        assert calculated["total_cost"] == 131_250_150
        assert [line["unit_cost"] for line in calculated["lines"]] == [875_001, 218_750]
        assert len(calculated["warnings"]) == 1
        warning = calculated["warnings"][0]
        assert warning["key"] == "rate_deviation:receipt:-:CNY:77.0001:70.0000"
        assert warning["params"]["nbk_exact"] is True
        assert warning["params"]["percent"] == 10
        print("preview: 200; total_cost=131250150; unit_cost=[875001, 218750]")
        print(json.dumps(warning, ensure_ascii=False))
        status, refused = call("POST", "/receipts", payload)
        assert status == 409 and refused["code"] == "receipt_warnings", refused
        assert refused["params"]["warnings"] == calculated["warnings"]
        print("confirmed_warnings=[]: 409 receipt_warnings")
        payload["confirmed_warnings"] = [w["key"] for w in calculated["warnings"]]
        status, posted = call("POST", "/receipts", payload)
        assert status == 201 and posted["total_cost"] == calculated["total_cost"], posted
        print("confirmed keys: 201")
        payload["confirmed_warnings"] = []
        status, replay = call("POST", "/receipts", payload)
        assert status == 200 and replay == posted, replay
        print("replay with empty confirmations: 200; same document")
    finally:
        status, body = call("PUT", "/settings", saved_settings)
        assert status == 200, body
        engine.dispose()


if __name__ == "__main__":
    main()

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from threading import Barrier
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.errors import ExpenseRequestConflictError
from app.expenses import service
from app.expenses.models import Expense
from app.expenses.schemas import ExpenseCreate
from app.numbering import DocumentCounter
from app.rates import service as rates_service
from tests.factories import create_user

PERIOD = {"from": "2026-09-01", "to": "2026-09-30"}


def payload(**changes):
    return {
        "request_id": str(uuid.uuid4()),
        "items": [
            {"expense_date": "2026-09-30", "category": "rent", "amount": 10000, "note": "  офис  "}
        ],
        **changes,
    }


def create(client, **changes):
    response = client.post("/api/expenses", json=payload(**changes))
    assert response.status_code == 201, response.text
    return response.json()["items"]


def test_batch_replay_order_note_and_cancelled_replay(auth_client):
    body = payload()
    body["items"].append(
        {"expense_date": "2026-09-29", "category": "salary", "amount": 20000, "note": " "}
    )
    first = auth_client.post("/api/expenses", json=body)
    assert first.status_code == 201
    items = first.json()["items"]
    assert items[1]["number"] == items[0]["number"] + 1
    assert [item["note"] for item in items] == ["офис", None]
    assert items[0]["created_by_name"]
    replay = auth_client.post("/api/expenses", json=body)
    assert replay.status_code == 200 and replay.json() == first.json()
    for changed in [
        list(reversed(body["items"])),
        [{**body["items"][0], "note": "другая"}, body["items"][1]],
        body["items"][:1],
    ]:
        conflict = auth_client.post("/api/expenses", json={**body, "items": changed})
        assert conflict.status_code == 409
        assert conflict.json()["code"] == "expense_request_conflict"
        assert conflict.json()["params"] == {"id": items[0]["id"], "number": items[0]["number"]}
    path = f"/api/expenses/{items[0]['id']}"
    assert auth_client.get(path).json() == items[0]
    assert auth_client.post(path + "/cancel", json={"reason": " "}).status_code == 422
    cancelled = auth_client.post(path + "/cancel", json={"reason": " Ошибка ввода "})
    assert cancelled.status_code == 200
    assert cancelled.json()["cancel_reason"] == "Ошибка ввода"
    assert cancelled.json()["cancelled_by_name"] and cancelled.json()["cancelled_at"]
    assert (
        auth_client.post(path + "/cancel", json={"reason": "Повтор"}).json()["code"]
        == "expense_already_cancelled"
    )
    assert (
        auth_client.post("/api/expenses/999999999/cancel", json={"reason": "Ошибка"}).status_code
        == 404
    )
    assert auth_client.get("/api/expenses/999999999").json()["code"] == "expense_not_found"
    assert auth_client.post("/api/expenses", json=body).json()["items"][0]["status"] == "cancelled"


def test_filters_pagination_month_end_and_cancelled_expense(auth_client):
    a, b, c = create(
        auth_client,
        items=[
            {"expense_date": "2026-09-30", "category": "rent", "amount": 10000},
            {"expense_date": "2026-09-30", "category": "salary", "amount": 20000},
            {"expense_date": "2026-09-01", "category": "rent", "amount": 30000},
        ],
    )
    create(auth_client, items=[{"expense_date": "2026-10-01", "category": "other", "amount": 1}])
    response = auth_client.get("/api/expenses", params={**PERIOD, "limit": 1, "offset": 1}).json()
    assert response["total"] == 3 and response["posted_amount"] == 60000
    assert [item["id"] for item in response["items"]] == [a["id"]]
    assert (
        auth_client.post(f"/api/expenses/{a['id']}/cancel", json={"reason": "Ошибка"}).status_code
        == 200
    )
    result = auth_client.get("/api/expenses", params=PERIOD).json()
    assert [item["id"] for item in result["items"]] == [b["id"], a["id"], c["id"]]
    assert result["posted_amount"] == 50000
    posted = auth_client.get(
        "/api/expenses", params={**PERIOD, "status": "posted", "category": ["rent", "salary"]}
    ).json()
    assert posted["total"] == 2 and posted["posted_amount"] == 50000
    cancelled = auth_client.get("/api/expenses", params={**PERIOD, "status": "cancelled"}).json()
    assert cancelled["total"] == 1 and cancelled["posted_amount"] == 0
    assert (
        auth_client.get("/api/expenses", params={**PERIOD, "category": "rent"}).json()["total"] == 2
    )
    summary = auth_client.get("/api/reports/summary", params=PERIOD).json()
    assert summary["expenses_total"] == 50000 and summary["expenses_count"] == 2
    assert summary["profit_after_expenses"] == -50000
    assert summary["expenses_by_category"] == [
        {"category": "rent", "amount": 30000, "count": 1},
        {"category": "salary", "amount": 20000, "count": 1},
    ]


@pytest.mark.parametrize(
    "item",
    [
        {"amount": 0},
        {"amount": -1},
        {"amount": "1"},
        {"amount": True},
        {"amount": 1.5},
        {"amount": 10**15 + 1},
        {"category": "missing"},
        {"note": "x" * 501},
    ],
)
def test_validation(auth_client, item):
    body = payload()
    body["items"][0].update(item)
    assert auth_client.post("/api/expenses", json=body).status_code == 422


@pytest.mark.parametrize("count", [0, 21])
def test_batch_size(auth_client, count):
    body = payload()
    body["items"] *= count
    assert auth_client.post("/api/expenses", json=body).status_code == 422


@pytest.mark.parametrize("time", ["2026-09-30T23:30:00+05:00", "2026-10-01T00:30:00+05:00"])
def test_almaty_today_and_tomorrow(auth_client, monkeypatch, time):
    moment = datetime.fromisoformat(time)

    class Clock:
        @staticmethod
        def now(tz):
            return moment.astimezone(tz)

    monkeypatch.setattr(rates_service, "datetime", Clock)
    today = moment.astimezone(ZoneInfo("Asia/Almaty")).date()
    create(
        auth_client, items=[{"expense_date": today.isoformat(), "category": "rent", "amount": 1}]
    )
    response = auth_client.post(
        "/api/expenses",
        json=payload(
            items=[
                {
                    "expense_date": (today + timedelta(days=1)).isoformat(),
                    "category": "rent",
                    "amount": 1,
                }
            ]
        ),
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["type"] == "expense_date_in_future"


@pytest.mark.parametrize(
    "params",
    [
        {"from": "2026-10-01", "to": "2026-09-01"},
        {"from": "2025-01-01", "to": "2026-01-02"},
        {**PERIOD, "limit": 201},
        {**PERIOD, "offset": -1},
    ],
)
def test_list_validation(auth_client, params):
    assert auth_client.get("/api/expenses", params=params).status_code == 422


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("POST", "/api/expenses", payload()),
        ("GET", "/api/expenses", None),
        ("GET", "/api/expenses/1", None),
        ("POST", "/api/expenses/1/cancel", {"reason": "Ошибка"}),
    ],
)
def test_auth(client, method, path, body):
    assert client.request(method, path, json=body, params=PERIOD).status_code == 401


def test_rollback_returns_numbers(db_session):
    user = create_user(db_session)
    before = db_session.get(DocumentCounter, "expense").last_number
    original = service.next_number
    calls = 0

    def fail_second(db, kind):
        nonlocal calls
        calls += 1
        number = original(db, kind)
        if calls == 2:
            raise RuntimeError("rollback")
        return number

    data = ExpenseCreate.model_validate(payload(items=payload()["items"] * 2))
    with (
        pytest.raises(RuntimeError),
        db_session.begin_nested(),
        patch.object(service, "next_number", fail_second),
    ):
        service.post_expenses(db_session, data, user.id)
    saved, _ = service.post_expenses(db_session, ExpenseCreate.model_validate(payload()), user.id)
    assert saved.items[0].number == before + 1


def test_list_query_count_constant(db_session):
    user = create_user(db_session)
    for size in (1, 20):
        service.post_expenses(
            db_session,
            ExpenseCreate.model_validate(payload(items=payload()["items"] * size)),
            user.id,
        )
        statements = []

        def record(*args, statements=statements):
            statements.append(args[2])

        conn = db_session.connection()
        event.listen(conn, "before_cursor_execute", record)
        try:
            page = service.list_expenses(
                db_session, date(2026, 9, 1), date(2026, 9, 30), [], None, 50, 0
            )
            assert page.total >= size and len(statements) == 2
        finally:
            event.remove(conn, "before_cursor_execute", record)


@pytest.mark.parametrize("conflict", [False, True])
def test_concurrent_expense_50(isolated_stock_engine, conflict):
    engine = isolated_stock_engine
    with Session(engine) as db:
        user_id = create_user(db).id
        db.commit()
    body = payload(items=payload()["items"] * 2)
    data = ExpenseCreate.model_validate(body)
    if conflict:
        with Session(engine) as db:
            first, _ = service.post_expenses(db, data, user_id)
    barrier = Barrier(50)

    def run(index):
        local = (
            ExpenseCreate.model_validate(
                {**body, "items": [{**item, "note": f"conflict {index}"} for item in body["items"]]}
            )
            if conflict
            else data
        )
        barrier.wait(timeout=20)
        with Session(engine) as db:
            if conflict:
                with pytest.raises(ExpenseRequestConflictError) as exc:
                    service.post_expenses(db, local, user_id)
                assert exc.value.params == {
                    "id": first.items[0].id,
                    "number": first.items[0].number,
                }
                return False
            result, created = service.post_expenses(db, local, user_id)
            return created, [item.id for item in result.items]

    with ThreadPoolExecutor(max_workers=50) as executor:
        results = list(executor.map(run, range(50)))
    if not conflict:
        assert sum(created for created, _ in results) == 1
        assert len({tuple(ids) for _, ids in results}) == 1
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Expense)) == 2
        assert db.get(DocumentCounter, "expense").last_number == 2

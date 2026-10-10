import pytest
from sqlalchemy import func, select

from app.inventory.models import StockMovement
from app.returns.models import SaleReturn
from tests.return_helpers import make_sale, post_return, return_data


def test_expected_split_matches_and_replay_ignores_expectations(auth_client, return_case):
    sale = make_sale(return_case, paid=900)
    data = return_data(sale, 2, expected_debt_credit=100, expected_refund_amount=100)
    first = auth_client.post("/api/returns", json=data.model_dump(mode="json"))
    assert first.status_code == 201, first.text
    assert (first.json()["debt_credit"], first.json()["refund_amount"]) == (100, 100)
    # A replay uses the saved document even though customer debt has since changed.
    data.expected_debt_credit = 0
    data.expected_refund_amount = 200
    replay = auth_client.post("/api/returns", json=data.model_dump(mode="json"))
    assert replay.status_code == 200 and replay.json() == first.json()


def test_changed_split_rolls_back_and_preserves_number(auth_client, return_case):
    case = return_case
    sale = make_sale(case)
    first = post_return(case, sale)
    movements = case.db.scalar(select(func.count()).select_from(StockMovement))
    data = return_data(
        sale, 2, refund_method="card", expected_debt_credit=0, expected_refund_amount=200
    )
    failed = auth_client.post("/api/returns", json=data.model_dump(mode="json"))
    assert failed.status_code == 409, failed.text
    assert failed.json()["code"] == "return_split_changed"
    assert failed.json()["params"] == {"debt_credit": 200, "refund_amount": 0}
    assert case.db.scalar(select(func.count()).select_from(SaleReturn)) == 1
    assert case.db.scalar(select(func.count()).select_from(StockMovement)) == movements
    data.expected_debt_credit = 200
    data.expected_refund_amount = 0
    data.refund_method = None
    saved = auth_client.post("/api/returns", json=data.model_dump(mode="json"))
    assert saved.status_code == 201, saved.text
    assert saved.json()["number"] == first.number + 1


@pytest.mark.parametrize("field", ["expected_debt_credit", "expected_refund_amount"])
def test_expected_split_requires_both_fields(auth_client, return_case, field):
    sale = make_sale(return_case)
    body = return_data(sale).model_dump(mode="json", exclude_none=True)
    body[field] = 0
    response = auth_client.post("/api/returns", json=body)
    assert response.status_code == 422
    assert response.json()["errors"][0]["type"] == "return_expected_split_pair"


@pytest.mark.parametrize("amount", [-1, 1.5, True, 2**63])
def test_expected_amount_is_nonnegative_bigint(auth_client, return_case, amount):
    sale = make_sale(return_case)
    body = return_data(sale).model_dump(mode="json")
    body.update(expected_debt_credit=amount, expected_refund_amount=0)
    assert auth_client.post("/api/returns", json=body).status_code == 422

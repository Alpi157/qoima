import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import create_product


@pytest.fixture
def catalog(db_session: Session) -> None:
    create_product(db_session, article="AOC90", name="Фильтр воздушный")
    create_product(db_session, article="OC901", name="Фильтр топливный")
    create_product(db_session, article="OC90", name="Фильтр салона")
    create_product(db_session, article="W712", name="Фильтр масляный")


def _search(client: TestClient, **params: object) -> dict:
    response = client.get("/api/products", params=params)
    assert response.status_code == 200
    return response.json()


def _articles(client: TestClient, **params: object) -> list[str]:
    return [item["article"] for item in _search(client, **params)["items"]]


@pytest.mark.usefixtures("catalog")
def test_search_without_query_lists_all_by_article(auth_client: TestClient) -> None:
    body = _search(auth_client)
    assert [i["article"] for i in body["items"]] == ["AOC90", "OC90", "OC901", "W712"]
    assert body["total"] == 4


@pytest.mark.usefixtures("catalog")
def test_search_ranks_exact_prefix_substring(auth_client: TestClient) -> None:
    assert _articles(auth_client, q="oc90") == ["OC90", "OC901", "AOC90"]


@pytest.mark.usefixtures("catalog")
def test_search_cyrillic_lookalike_article(auth_client: TestClient) -> None:
    # "ос" typed in Cyrillic.
    assert _articles(auth_client, q="ос-90")[0] == "OC90"


@pytest.mark.usefixtures("catalog")
@pytest.mark.parametrize("q", ["масл", "фильт", "фильтер", "МАСЛЯНЫЙ"])
def test_search_by_name(auth_client: TestClient, q: str) -> None:
    assert "W712" in _articles(auth_client, q=q)


@pytest.mark.usefixtures("catalog")
def test_search_by_name_ranks_after_article(auth_client: TestClient, db_session: Session) -> None:
    create_product(db_session, article="X1", name="Прокладка W712")
    assert _articles(auth_client, q="w712") == ["W712", "X1"]


@pytest.mark.usefixtures("catalog")
@pytest.mark.parametrize("q", ["%", "_", "\\", "%%%"])
def test_search_wildcards_match_nothing(auth_client: TestClient, q: str) -> None:
    body = _search(auth_client, q=q)
    assert body == {"items": [], "total": 0}


@pytest.mark.usefixtures("catalog")
def test_search_unknown_query(auth_client: TestClient) -> None:
    assert _search(auth_client, q="zzzz") == {"items": [], "total": 0}


def test_archived_hidden_unless_requested(auth_client: TestClient, db_session: Session) -> None:
    create_product(db_session, article="OC90", name="Фильтр", is_archived=True)

    assert _articles(auth_client, q="oc90") == []
    assert _articles(auth_client) == []
    assert _articles(auth_client, q="oc90", include_archived=True) == ["OC90"]
    assert _articles(auth_client, include_archived=True) == ["OC90"]


@pytest.mark.usefixtures("catalog")
def test_search_pagination(auth_client: TestClient) -> None:
    body = _search(auth_client, limit=2, offset=1)
    assert [i["article"] for i in body["items"]] == ["OC90", "OC901"]
    assert body["total"] == 4


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 201}, {"offset": -1}])
def test_search_pagination_bounds(auth_client: TestClient, params: dict[str, int]) -> None:
    assert auth_client.get("/api/products", params=params).status_code == 422

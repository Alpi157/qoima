from pathlib import Path

from fastapi.testclient import TestClient

from app.errors import AppError, ErrorCode
from app.main import app

ARCHITECTURE_DOC = Path(__file__).resolve().parents[2] / "docs" / "architecture.md"


def _app_error_classes() -> list[type[AppError]]:
    found: list[type[AppError]] = []
    pending = list(AppError.__subclasses__())
    while pending:
        cls = pending.pop()
        found.append(cls)
        pending.extend(cls.__subclasses__())
    return found


def test_every_app_error_has_its_own_code() -> None:
    classes = _app_error_classes()
    codes = [cls.code for cls in classes]

    missing = [cls.__name__ for cls in classes if "code" not in vars(cls)]
    assert missing == []
    assert len(codes) == len(set(codes))
    assert ErrorCode.APP_ERROR not in codes
    assert ErrorCode.VALIDATION_ERROR not in codes


def test_error_code_enum_lists_exactly_the_used_codes() -> None:
    used = {cls.code for cls in _app_error_classes()}
    assert set(ErrorCode) == used | {ErrorCode.APP_ERROR, ErrorCode.VALIDATION_ERROR}


def test_codes_are_snake_case() -> None:
    for code in ErrorCode:
        assert code.value == code.name.lower()


def test_every_code_is_documented() -> None:
    doc = ARCHITECTURE_DOC.read_text(encoding="utf-8")
    undocumented = [code.value for code in ErrorCode if f"`{code.value}`" not in doc]
    assert undocumented == []


def test_error_schema_is_in_openapi() -> None:
    schemas = app.openapi()["components"]["schemas"]
    assert schemas["ErrorCode"]["enum"] == [code.value for code in ErrorCode]
    assert "ErrorOut" in schemas


def test_not_authenticated_code(client: TestClient) -> None:
    response = client.get("/api/sales")
    assert response.status_code == 401
    assert response.json()["code"] == "not_authenticated"


def test_validation_error_code(auth_client: TestClient) -> None:
    response = auth_client.put("/api/settings", json={})
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"

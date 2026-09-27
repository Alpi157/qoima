import json

from app.export_openapi import render_openapi


def test_render_openapi_is_valid_json_with_api_paths() -> None:
    schema = json.loads(render_openapi())

    assert schema["info"]["title"] == "Qoima API"
    assert "/api/auth/me" in schema["paths"]
    assert "/api/auth/login" in schema["paths"]


def test_render_openapi_is_deterministic() -> None:
    assert render_openapi() == render_openapi()

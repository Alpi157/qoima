import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parents[1]
DOC_PATHS = ["/docs", "/redoc", "/openapi.json"]


@pytest.mark.parametrize("path", DOC_PATHS)
def test_docs_are_served_by_default(path: str) -> None:
    settings = get_settings().model_copy(update={"enable_docs": True})
    response = TestClient(create_app(settings)).get(path)
    assert response.status_code == 200


@pytest.mark.parametrize("path", DOC_PATHS)
def test_docs_are_disabled(path: str) -> None:
    settings = get_settings().model_copy(update={"enable_docs": False})
    response = TestClient(create_app(settings)).get(path)
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_openapi_export_works_with_docs_disabled() -> None:
    # A fresh process, so the module-level app is built with ENABLE_DOCS=false.
    result = subprocess.run(
        [sys.executable, "-m", "app.export_openapi"],
        cwd=BACKEND_DIR,
        env={**os.environ, "ENABLE_DOCS": "false"},
        capture_output=True,
        text=True,
        check=True,
    )
    assert '"/api/auth/login"' in result.stdout

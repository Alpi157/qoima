"""Print the OpenAPI schema as JSON to stdout.

Usage: uv run python -m app.export_openapi > ../frontend/openapi.json
"""

import json
import os
import sys

# Importing the app builds the engine but never connects, so any URL works when no .env is present
# (for example in CI). A real DATABASE_URL from the environment is kept.
_PLACEHOLDER_DATABASE_URL = "postgresql+psycopg://openapi:openapi@localhost:5432/openapi"


def render_openapi() -> str:
    os.environ.setdefault("DATABASE_URL", _PLACEHOLDER_DATABASE_URL)
    from app.main import app

    return json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n"


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write(render_openapi())


if __name__ == "__main__":
    main()

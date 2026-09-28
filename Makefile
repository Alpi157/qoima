.PHONY: db backend frontend migrate create-user test lint gen-api review

db:
	docker compose up -d db

backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

migrate:
	cd backend && uv run alembic upgrade head

LOCALE ?= kk

create-user:
	cd backend && uv run python -m app.cli create-user --username "$(USERNAME)" --full-name "$(FULL_NAME)" --locale "$(LOCALE)"

test:
	cd backend && uv run pytest
	cd frontend && npm test -- --run

lint:
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd frontend && npm run lint && npm run format:check && npm run i18n:check

gen-api:
	cd backend && uv run python -m app.export_openapi > ../frontend/openapi.json
	cd frontend && npm run gen:api

review:
	bash scripts/make_review.sh $(STEP)

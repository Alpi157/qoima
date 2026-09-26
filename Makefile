.PHONY: db backend frontend migrate test lint review

db:
	docker compose up -d db

backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

migrate:
	cd backend && uv run alembic upgrade head

test:
	cd backend && uv run pytest

lint:
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd frontend && npm run lint && npm run format:check

review:
	bash scripts/make_review.sh $(STEP)

.PHONY: db backend frontend migrate create-user import-products test lint gen-api review demo screenshots

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

import-products:
	@if [ -z "$(FILE)" ] || [ -z "$(USER)" ]; then \
		echo 'Пробный прогон: make import-products FILE=import/qoima-import.xlsx USER=owner'; \
		echo 'Применение: make import-products FILE=import/qoima-import.xlsx USER=owner APPLY=1'; \
		echo 'Рабочие XLSX храните в import/ в корне проекта: папка исключена из git.'; \
		exit 1; \
	fi
	cd backend && uv run python -m app.cli import-products "$(abspath $(FILE))" --user "$(USER)" $(if $(filter 1,$(APPLY)),--apply)

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

# Demo database qoima_demo (the working database is not touched). DEMO_PASSWORD is the password
# of the user "demo"; screenshots generate one for the run when it is not set.
demo:
	cd backend && uv run python -m app.demo seed

screenshots:
	rm -rf review/screenshots && mkdir -p review/screenshots
	export DEMO_PASSWORD="$${DEMO_PASSWORD:-$$(openssl rand -hex 12)}" && \
	cd backend && uv run python -m app.demo seed && \
	cd ../frontend && npx playwright test

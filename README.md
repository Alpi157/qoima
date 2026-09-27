# Qoima

Веб-система учёта продаж автозапчастей. Подробности о проекте — в `CLAUDE.md`,
архитектура — в `docs/architecture.md`, план работ — в `docs/plan.md`.

## Стек

Backend: Python 3.12, FastAPI, SQLAlchemy 2, PostgreSQL 17. Frontend: React,
TypeScript, Vite, Mantine.

## Как запустить с нуля

Нужны: Docker с Docker Compose, [uv](https://docs.astral.sh/uv/), Node.js LTS.

1. Скопировать файл с настройками и заполнить его:

   ```bash
   cp .env.example .env
   ```

2. Поднять базу данных (при первом запуске создаются база `qoima` и
   тестовая база `qoima_test`):

   ```bash
   make db
   ```

3. Установить зависимости и применить миграции:

   ```bash
   cd backend && uv sync && cd ..
   make migrate
   ```

4. Запустить backend (в одном терминале) и frontend (в другом):

   ```bash
   make backend
   make frontend
   ```

5. Открыть `http://localhost:5173` — должна отображаться надпись «API: ok».

## Проверки

```bash
make test    # тесты backend (pytest, реальный PostgreSQL)
make lint    # ruff (backend) и eslint (frontend)
```

`npm run build` в `frontend/` собирает продакшн-сборку фронтенда.

## Генерация типов API

После того как backend запущен (`make backend`), можно обновить TypeScript-типы
из OpenAPI-схемы:

```bash
cd frontend && npm run gen:api
```

## Формирование пакета для ревью

```bash
bash scripts/make_review.sh <номер шага>
```

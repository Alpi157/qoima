# Qoima: учёт продаж автозапчастей

## О проекте

Веб-система учёта для небольшого бизнеса по продаже автозапчастей без торгового зала.
Один пользователь (владелец). Сейчас около 70 видов товаров, со временем будет больше.
Основные действия: найти товар по артикулу, провести приход, провести продажу покупателю,
напечатать накладную. Покупатели платят наличными.

- Архитектура и модель данных: `docs/architecture.md`
- План работ по шагам: `docs/plan.md`

## Стек

- Backend: Python 3.12, FastAPI, SQLAlchemy 2 (синхронный режим), psycopg 3, Alembic,
  Pydantic v2, pydantic-settings, argon2-cffi. Зависимости и запуск через `uv`.
- База данных: PostgreSQL 17 в docker compose, расширение `pg_trgm`.
- Frontend: React, TypeScript, Vite, Mantine, TanStack Query, React Router. Пакеты через `npm`.
- Тесты: pytest против настоящего PostgreSQL (отдельная база `qoima_test`). SQLite не использовать.
- Линтеры: ruff (lint и format), ESLint, Prettier.

## Команды

Этот раздел поддерживается в актуальном виде. Если команда изменилась, обнови её здесь.

- Запустить базу: `make db` (или `docker compose up -d db`)
- Установить зависимости backend: `cd backend && uv sync`
- Применить миграции: `make migrate` (или `cd backend && uv run alembic upgrade head`)
- Запустить backend (localhost:8000): `make backend`
- Запустить frontend (localhost:5173, проксирует `/api` на backend): `make frontend`
- Создать пользователя (пароль спросит дважды): `make create-user USERNAME=owner FULL_NAME="Имя"`
  (язык интерфейса `LOCALE=kk|ru|zh`, по умолчанию `kk`; или
  `cd backend && uv run python -m app.cli create-user --username owner --full-name "Имя" --locale kk`)
- Сменить пароль: `cd backend && uv run python -m app.cli set-password --username owner`
- Все тесты (backend и frontend): `make test`
- Тесты backend: `cd backend && uv run pytest`
- Тесты frontend (vitest): `cd frontend && npm test -- --run` (без `--run` в режиме наблюдения)
- Линтеры backend и frontend: `make lint` (включает проверку ключей переводов)
- Проверка имён файлов фронтенда на слова, которые режут блокировщики рекламы:
  `cd frontend && npm run names:check` (входит в `npm run lint`; `npm run build` также проверяет
  `dist/assets`)
- Проверка ключей переводов: `cd frontend && npm run i18n:check` (падает, если ключа из кода нет
  в `ru.json` или в `ru.json` есть лишний ключ; если в `kk.json`/`zh.json` не хватает ключа, есть
  лишний или другой набор `{{переменных}}` и `<тегов>`, чем в русской строке; формы множественного
  числа по `Intl.PluralRules` языка, `invoice.*` в kk и zh не нужны; печатает процент перевода)
- Форматирование backend: `cd backend && uv run ruff format .`
- Форматирование frontend: `cd frontend && npm run format`
- Сборка frontend: `cd frontend && npm run build`
- Генерация типов API: `make gen-api` (запускать backend и базу не нужно). Выгружает схему
  в `frontend/openapi.json` и генерирует `frontend/src/api/schema.ts`; оба файла в git,
  CI проверяет, что они актуальны. После изменения API бэкенда запускать обязательно.
- Продакшн-стек (из корня репозитория, настройки в `deploy/.env.prod`, шаблон
  `deploy/.env.prod.example`): `docker compose -f deploy/docker-compose.prod.yml up -d --build --wait`;
  остановить: `docker compose -f deploy/docker-compose.prod.yml down` (`-v` удалит и данные).
  Локальная проверка: `DOMAIN=localhost` в `deploy/.env.prod`, затем `curl -k https://localhost/api/health`.
- Пользователь на проде: `docker compose -f deploy/docker-compose.prod.yml exec api python -m app.cli create-user --username owner --full-name "Имя"`
- Бэкап (на сервере): `AGE_RECIPIENTS_FILE=/etc/qoima/backup.pub bash deploy/backup.sh`
- Проверка бэкапа в базе `qoima_restore_check`: `bash deploy/restore.sh --identity КЛЮЧ ФАЙЛ.dump.age`
  (подробно, включая `--into-main` и `pull-backups.sh`, в `deploy/README.md`)
- Демо-база `qoima_demo` (рабочая база не затрагивается): `DEMO_PASSWORD=... make demo`
  (или `cd backend && uv run python -m app.demo seed`); API на демо-базе:
  `cd backend && uv run python -m app.demo serve --port 8011`. Пользователь `demo`, язык kk,
  пароль из переменной `DEMO_PASSWORD`, в git его нет.
- Снимки экранов: `make screenshots` (пересоздаёт `qoima_demo`, поднимает API на 8011 и фронтенд
  на 5183, снимает все экраны в 1366x800 и 390x844 в `review/screenshots/`; пароль demo берётся
  из `DEMO_PASSWORD` или генерируется на запуск). Один раз поставить браузер:
  `cd frontend && npx playwright install chromium`.
- Собрать пакет для ревью: `make review STEP=NN` (или `bash scripts/make_review.sh NN`)

## Жёсткие правила архитектуры

1. Остаток товара меняется ТОЛЬКО через `backend/app/inventory/service.py`, функцию
   `post_movements(...)`. Она в одной транзакции вставляет строки в `stock_movements`
   и обновляет `stock_balances`. Никакой другой код не пишет в эти две таблицы.
2. `stock_movements` только для вставки. Триггер в базе запрещает UPDATE и DELETE.
3. Проведённые документы (приход, продажа) не редактируются и не удаляются.
   Ошибка исправляется отменой документа, отмена создаёт обратные движения.
4. Деньги хранятся как BIGINT в тиынах (1 тенге = 100 тиынов) и передаются через API
   целым числом тиынов. Float для денег запрещён везде. Форматирование в тенге только на фронтенде.
5. Бизнес-логика живёт только в `service.py`. Router: принять и провалидировать запрос,
   вызвать сервис, вернуть ответ.
6. Схема базы меняется только новой миграцией Alembic. Уже закоммиченные миграции не редактировать.
7. Время хранится как `timestamptz` в UTC. Показывается пользователю в поясе `Asia/Almaty`.
8. Артикулы сравниваются и ищутся только по нормализованному виду
   (`backend/app/catalog/normalize.py`).
9. Все эндпоинты, кроме `/api/health`, `/api/auth/login` и `/api/auth/logout`, требуют авторизации.
10. Количество товара это целое положительное число в строках документов.
11. Одна операция пользователя = один commit, его делает сервис документа верхнего уровня.
    post_movements и другие внутренние функции commit не делают. При бизнес-ошибке транзакция
    откатывается целиком. Сервисы не перехватывают AppError, чтобы затем сделать commit.
12. Весь интерфейс следует `docs/design/design-system.md` (шкалы шрифтов и отступов, три размера
    элементов управления, поверхности, анатомия страницы). Страницы собираются из общих
    компонентов `frontend/src/components/ui/`. Любой шаг, который меняет интерфейс, заканчивается
    `make screenshots` и просмотром каждого снимка по списку из раздела «Проверка глазами»;
    найденное и исправленное пишется в REVIEW.md.

## Соглашения по коду

- Идентификаторы, имена файлов и комментарии в коде на английском.
  Тексты интерфейса и сообщения об ошибках для пользователя на русском.
- Модуль backend устроен так: `models.py`, `schemas.py`, `service.py`, `router.py`.
- Ошибки бизнес-логики: свои исключения из `backend/app/errors.py`, которые превращаются
  в HTTP 4xx с понятным русским сообщением.
- Каждый новый эндпоинт и каждая бизнес-функция покрыты тестами.
- Новые роутеры подключаются только к `protected_api` в `backend/app/main.py`; к `public_api` не добавлять ничего.
- Типы API на фронтенде генерируются из OpenAPI-схемы бэкенда, руками не пишутся.
- В именах файлов и папок фронтенда (`frontend/src`) не использовать слова ad, ads, advert,
  banner, backlink, sponsor, promo, track, tracking, analytics, pixel, share, social, popup
  (и их множественное число) отдельной частью имени, в том числе склейкой частей camelCase
  (`BackLink`, `backLinks`). Блокировщики рекламы (uBlock, AdBlock) режут такие URL, модуль
  не загружается, и вместе с ним не открывается страница. Части других слов (header, loader,
  badge) можно. Проверяет `npm run names:check` в `npm run lint`, а `npm run build` проверяет
  имена чанков в `dist/assets`.
- Не оставлять закомментированный код, отладочные print и TODO без пояснения.

## Как работать над задачей

- Работай только над тем шагом из `docs/plan.md`, который указан в задании. Не начинай следующий.
- Не делай `git commit` и `git push`. Коммиты делает человек после ревью.
- Не читай и не изменяй `.env`. Все настройки описывай в `.env.example`.
- Новые зависимости добавлять можно, если они нужны для текущего шага. Каждую перечисли в REVIEW.md с причиной.
- Если в задании что-то неясно или противоречит этому файлу, выбери самый простой вариант,
  который соблюдает правила выше, и запиши вопрос в REVIEW.md. Не останавливайся ради вопроса.

## Завершение задачи (обязательно в конце каждого шага)

1. Прогони линтеры и тесты бэкенда и фронтенда, исправь все ошибки.
2. Обнови раздел «Команды» в этом файле, если что-то изменилось.
3. Напиши `review/REVIEW.md` на русском со следующими разделами:
   - Шаг и задача
   - Что сделано (коротко, по пунктам)
   - Новые и изменённые файлы
   - Принятые решения и отклонения от задания (с причинами)
   - Новые зависимости
   - Результаты проверок (ruff, pytest, сборка фронтенда)
   - Как проверить руками (конкретные команды и что должно получиться)
   - Открытые вопросы
4. Запусти `bash scripts/make_review.sh <номер шага>` и в конце ответа напиши путь к zip-файлу.

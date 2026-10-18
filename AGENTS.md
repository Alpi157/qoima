# Qoima: учёт продаж автозапчастей

## О проекте

Веб-система учёта для небольшого бизнеса по продаже автозапчастей без торгового зала.
Один пользователь (владелец). Сейчас около 70 видов товаров, со временем будет больше.
Основные действия: найти товар по артикулу, провести приход, провести продажу покупателю,
напечатать накладную. Покупатели платят наличными или картой/Kaspi.

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
- Загрузить курсы Нацбанка: `cd backend && uv run python -m app.cli rates-fetch --from 2026-10-11 --to 2026-10-17`
  (обе валюты по умолчанию; можно повторить `--currency CNY --currency USD`, максимум 400 дней
  включительно). На сервере из корня: `docker compose -f deploy/docker-compose.prod.yml exec api python -m app.cli rates-fetch --from 2026-10-11 --to 2026-10-17`.
  Уже записанные курсы не загружаются; код 0 — все есть, 1 — хотя бы одного точного курса нет,
  2 — ошибка аргументов. Команда за последние 7 дней — в deploy/README.md.
- Импорт товаров и начальных остатков: `make import-products FILE=import/qoima-import.xlsx USER=owner`
  (пробный прогон); для записи добавить `APPLY=1`. CLI:
  `cd backend && uv run python -m app.cli import-products ../import/qoima-import.xlsx --user owner [--apply]`.
  Рабочие XLSX хранить в корневой папке `import/`, исключённой из git.
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
  числа по `Intl.PluralRules` языка, `invoice.*` в kk и zh не нужны; печатает процент перевода;
  также ищет в kk.json запрещённые основы из `frontend/scripts/kk-forbidden-stems.json`
  как подстроки без учёта регистра; список пояснён в `docs/glossary.md`)
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
  Демо содержит CNY 67.6200 и USD 452.1200 за последние 31 день и валютный приход
  с доставкой и пошлиной. `app.demo serve` принудительно использует закрытый локальный
  адрес ленты: внешних запросов Нацбанку из демо и e2e нет.
- Локальный сценарий валютного прихода 26a-2 (после подготовки demo и запуска API на 8011):
  `cd backend && DEMO_PASSWORD=... uv run python ../scripts/check_receipt_26a2.py`.
  Записывает курс 70.0000 только в локальную `qoima_demo`, проверяет preview и ответы
  409/201/200; создаёт два проверочных товара и один приход, прежние настройки восстанавливает.
- Снимки экранов: `make screenshots` (пересоздаёт `qoima_demo`, поднимает API на 8011 и фронтенд
  на 5183, снимает все экраны в 1366x800 и 390x844 в `review/screenshots/`, затем проходит продажу
  и приём по шагам, возврат годного товара и брака с отменой
  (`frontend/e2e/flows.spec.ts`, сохраняет документы в демо-базе), корректировку начального долга
  с оплатой и отменой, а также печатные снимки
  и PDF накладных на 3 и 12 строк с проверкой одной страницы A4; пароль demo берётся
  из `DEMO_PASSWORD` или генерируется на запуск). Снимок `sell-3-debt-focus`
  дополнительно проверяет фокус на 1366x768 и 390x844. Один раз поставить браузер:
  `cd frontend && npx playwright install chromium`.
  Для последовательного прогона: `make screenshots SCREENSHOT_WORKERS=1`;
  без параметра Playwright выбирает число workers как прежде.
- Дополнительная проверка собранных чанков: после подготовки демо-базы с тем же
  `DEMO_PASSWORD` выполнить `cd frontend && QOIMA_E2E_BUILD=1 npx playwright test --project=flows-1366 --project=flows-390 --no-deps -g "page module"`.
  Только при `QOIMA_E2E_BUILD=1` Playwright собирает frontend и запускает preview;
  обычные e2e, `make test` и `make screenshots` используют прежний запуск без дополнительной сборки.
- Проверки черновиков и бюджета действий (после подготовки `qoima_demo` с тем же
  `DEMO_PASSWORD`): `cd frontend && DEMO_PASSWORD=... npx playwright test --project=flows-1366 --project=flows-390 --no-deps -g "draft safety|action budget|currency receipt"`.
  Бюджет одного клика, заполнения поля и Enter хранится в `frontend/e2e/action-budget.json`;
  штатные сценарии не должны превышать зафиксированные числа.
- Снимки шага 23 (`draft-*`) дополнительно снимаются на kk в 1366x768 и 390x844,
  включая вид с действующей закреплённой панелью; входят в `make screenshots`.
- Снимки шага 24 (`snapshot-*`) на kk в 1366x768 и 390x844 показывают скидку в строке
  и проверке продажи, архивные остатки, предупреждение архивации и цену корректировки;
  входят в `make screenshots`. E2e также проверяет печать после переименования товара.
- Снимки шага 25 (`rates-*`): окно архивации с единицей «л» и накладная с пустым
  историческим снимком реквизитов, на kk в 1366x768 и 390x844; входят в `make screenshots`.
- Снимки шага 26b (`currency-*`): валюта, ручной и отсутствующий курс, расходы,
  ручная раскладка, проверка, предупреждения (включая KZT 409), карточка прихода,
  история закупок и настройки на kk в 1366x768 и 390x844; входят в `make screenshots`.
- Собрать пакет для ревью: `make review STEP=NN` (или `bash scripts/make_review.sh NN`)

## Жёсткие правила архитектуры

1. Остаток товара меняется ТОЛЬКО через `backend/app/inventory/service.py`, функцию
   `post_movements(...)`. Она в одной транзакции вставляет строки в `stock_movements`
   и обновляет `stock_balances`. Никакой другой код не пишет в эти две таблицы.
2. `stock_movements` только для вставки. Триггер в базе запрещает UPDATE и DELETE.
3. Проведённые документы (приход, продажа, возврат) не редактируются и не удаляются.
   Ошибка исправляется отменой документа, отмена создаёт обратные движения.
4. Деньги хранятся как BIGINT в тиынах (1 тенге = 100 тиынов) и передаются через API
   целым числом тиынов. Float для денег запрещён везде. Форматирование в тенге на фронтенде;
   форматирование тенге на backend допустимо только в выводе CLI-команд для человека;
   API и база всегда в тиынах.
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
13. Долг покупателя не хранится, считается только из проведённых продаж, оплат, debt_credit возвратов
    и знаковых amount корректировок долга.
14. Операции, меняющие долг, сначала блокируют строку покупателя через `SELECT ... FOR UPDATE`.
15. `avg_cost` меняется только в `post_movements` вместе с `qty`.
16. `sale_lines.unit_cost` это снимок на момент продажи, не пересчитывается.
17. Новый проводимый документ получает request_id: состав для сравнения, advisory-lock или
    повторная проверка после блокировок, IntegrityError только по своему ограничению.

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

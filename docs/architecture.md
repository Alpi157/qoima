# Архитектура v1

## Что делает система

Владелец продаёт автозапчасти без торгового зала. Сейчас он:

1. ищет товар по артикулу;
2. оформляет продажу: кому продал и сколько штук;
3. печатает накладную;
4. вручную добавляет приход товара (артикул и количество).

Покупатели платят наличными. Бренд обычно не указывается. У товара есть цена продажи.
Пользователь один. Сейчас около 70 видов товаров.

Первая версия делает ровно это, плюс вход по паролю, историю и ежедневные бэкапы.

Сознательно НЕ входит в v1: сканер штрихкодов, кассовые смены, терминалы, фискальные чеки
(интеграция с онлайн-кассой), Kaspi, несколько складов, долги покупателей, отчёты по прибыли,
импорт из других систем. Архитектура не мешает добавить это позже.

Важно: накладная из этой системы не является фискальным чеком онлайн-кассы.

## Схема

```
Браузер (ноутбук или телефон)
        │ HTTPS
        ▼
┌──────────────── VPS (Ubuntu 24.04) ────────────────┐
│  Caddy: HTTPS-сертификат и раздача фронтенда        │
│    ├── /       → React (собранные статические файлы)│
│    └── /api/*  → FastAPI (uvicorn)                  │
│                      │                              │
│                  PostgreSQL (только внутри docker)  │
│                                                     │
│  Каждую ночь: pg_dump → шифрование → копия вне VPS  │
└─────────────────────────────────────────────────────┘
```

В разработке: PostgreSQL в docker compose, FastAPI через `uv run uvicorn --reload`,
фронтенд через `npm run dev`. Vite проксирует `/api` на `localhost:8000`, поэтому фронт и API
работают как один источник (одинаковые cookie, нет проблем с CORS).

Одна установка обслуживает один бизнес. Мультиарендность не делаем.

## Backend: модули

```
backend/app/
├── main.py          создание FastAPI, подключение роутеров
├── config.py        настройки из .env (pydantic-settings)
├── db.py            engine, SessionLocal, get_db
├── errors.py        исключения бизнес-логики и их обработчики
├── cli.py           команды: создать пользователя, сменить пароль
├── auth/            пользователи, сессии, вход
├── catalog/         товары, нормализация артикула, поиск
├── customers/       покупатели
├── inventory/       движения и остатки (единственный, кто их меняет)
├── receipts/        приход и его отмена
├── sales/           продажи и их отмена
└── settings/        реквизиты продавца для накладной (Шаг 12)
```

## Модель данных

Все деньги BIGINT в тиынах. Все даты `timestamptz`. У всех таблиц `id BIGINT` identity.

### users
| поле | тип | заметки |
|---|---|---|
| username | text unique not null | |
| password_hash | text not null | argon2 |
| full_name | text not null | |
| role | text not null default 'owner' | на будущее |
| is_active | bool not null default true | |
| created_at | timestamptz | |

### user_sessions
| поле | тип | заметки |
|---|---|---|
| token_hash | text unique not null | sha256 от токена, сам токен только в cookie |
| user_id | fk users | |
| created_at, expires_at, last_seen_at | timestamptz | срок ровно 30 дней от входа, без продления |

### products
| поле | тип | заметки |
|---|---|---|
| article | text not null | как ввёл пользователь |
| article_norm | text not null unique | нормализованный артикул |
| brand | text null | необязательно, в уникальность не входит |
| name | text not null | |
| unit | text not null default 'шт' | |
| sale_price | bigint not null default 0, check >= 0 | тиыны |
| note | text null | |
| is_archived | bool not null default false | вместо удаления |
| created_at, updated_at | timestamptz | |

Индексы: unique на `article_norm`; GIN `gin_trgm_ops` на `article_norm` и на `lower(name)`.

### customers
| поле | тип | заметки |
|---|---|---|
| name | text not null | человек или СТО |
| phone | text null | |
| note | text null | |
| created_at | timestamptz | |

Индекс: GIN `gin_trgm_ops` на `lower(name)`.

### warehouses
| поле | тип | заметки |
|---|---|---|
| code | text unique not null | машинный код склада, основной склад: `main` |
| name | text not null | |
| created_at | timestamptz | |

Одна запись `code='main'`, `name='Основной'`, создаётся миграцией. Нужна, чтобы потом можно было
добавить склады. Если в движении склад не указан, `post_movements` использует склад `main`.

### receipts и receipt_lines (приход)
receipts: `number` (bigint unique, из `document_counters`), `received_at`, `supplier` (text null),
`note`, `status` ('posted' | 'cancelled'), `cancelled_at`, `cancelled_by`, `cancel_reason`,
`created_by`, `created_at`.

receipt_lines: `receipt_id`, `product_id`, `qty` (int, check > 0), `unit_cost` (bigint null, check >= 0).

Первое заполнение остатков делается обычным приходом с поставщиком «Начальные остатки».

### sales и sale_lines (продажа)
sales: `number` (bigint unique, из `document_counters`), `request_id` (uuid unique, защита от двойной отправки),
`customer_id` (null допустим), `sold_at`, `total` (bigint), `note`, `status` ('posted' | 'cancelled'),
`cancelled_at`, `cancelled_by`, `cancel_reason`, `created_by`, `created_at`.

sale_lines: `sale_id`, `product_id`, `qty` (int, check > 0), `unit_price` (bigint, check >= 0),
`line_total` (bigint). Цена подставляется из товара, но в строке её можно изменить.
Сохраняется та цена, по которой реально продали.

### document_counters (номера документов)
`doc_type` (text PK, check `IN ('receipt', 'sale')`), `last_number` (bigint, check >= 0).
Одна строка на тип документа, `last_number` — последний выданный номер.

Номер берёт `app/numbering.py::next_number(db, doc_type)`:
`UPDATE document_counters SET last_number = last_number + 1 WHERE doc_type = :t RETURNING last_number`,
в той же транзакции, что и создание документа, без commit.

Почему не sequence: `nextval` не откатывается, и каждая неудачная попытка (нехватка товара,
повтор `request_id`, любая ошибка после получения номера) оставляла бы дыру в нумерации
накладных. Строка счётчика меняется транзакционно: при откате номер возвращается, при commit
закрепляется за документом. Блокировка строки `UPDATE` заставляет одновременные проведения
одного типа документа брать номера по очереди (для одного пользователя это не заметно).
Номер отменённого документа остаётся за ним и повторно не выдаётся.

### stock_movements (журнал движений)
| поле | тип | заметки |
|---|---|---|
| product_id | fk | |
| warehouse_id | fk | |
| qty | int not null, check <> 0 | + приход, − расход |
| kind | text | 'receipt', 'receipt_cancel', 'sale', 'sale_cancel', 'adjustment' |
| doc_type, doc_id | text null, bigint null | ссылка на документ |
| note | text null | причина корректировки |
| created_by | fk users | |
| created_at | timestamptz | |

Триггер запрещает UPDATE и DELETE.

### stock_balances (текущие остатки)
PK (`product_id`, `warehouse_id`), `qty int not null check (qty >= 0)`.
Обновляется только функцией `inventory.service.post_movements` в той же транзакции,
что и вставка движений. Тест проверяет: остаток всегда равен сумме движений.

### business_settings (Шаг 12)
Реквизиты для накладной по форме З-2. Ровно одна строка: `id smallint PK CHECK (id = 1)`,
её создаёт миграция. `seller_name` (организация или ИП), `seller_iin_bin`, `responsible_person`
(ответственный за поставку), `released_by_name` (расшифровка подписи «Отпустил»; пусто — в
накладной имя пользователя, проводившего продажу), `chief_accountant` (расшифровка подписи
главного бухгалтера) — `text not null default ''` (пустая строка = не заполнено);
`updated_at timestamptz`.
API: `GET /api/settings`, `PUT /api/settings` (все поля обязательны, строки обрезаются;
ИИН/БИН пустой или ровно 12 цифр; остальные поля до 255 символов).

## Ключевые алгоритмы

### Нормализация артикула
1. Unicode NFKC, верхний регистр.
2. Кириллические буквы-двойники заменяются латинскими:
   А→A, В→B, Е→E, Ё→E, К→K, М→M, Н→H, О→O, Р→P, С→C, Т→T, У→Y, Х→X.
3. Остаются только A-Z, 0-9 и оставшиеся кириллические буквы. Пробелы, дефисы, точки,
   слэши и прочие символы удаляются.
4. Буква O и цифра 0 НЕ считаются одинаковыми.

Примеры: `ос-90` → `OC90`, `OC 90` → `OC90`, `0986.452.041` → `0986452041`, `ab/12_3` → `AB123`.

### Поиск товара
Запрос нормализуется. Результаты в порядке: точное совпадение артикула, артикул начинается с запроса,
артикул содержит запрос, похожесть названия (pg_trgm). Архивные товары скрыты. По умолчанию
50 результатов (`limit`), максимум 200, дальше постранично через `offset`.
В ответе есть остаток и цена.

### Проведение продажи (одна транзакция)
1. Если продажа с таким `request_id` уже есть: при том же составе вернуть её со статусом 200
   и ничего не создавать; при другом составе 409 «Этот запрос уже использован для другой
   продажи». Состав: покупатель и набор строк (товар, количество, цена), где цена — после
   подстановки `sale_price` товара, если `unit_price` не передан. Порядок строк не важен.
2. Проверить покупателя и строки (товар существует, не повторяется, не в архиве). Цена строки:
   переданная `unit_price` или `sale_price` товара; если цена не передана и у товара 0, ошибка 422.
3. Создать продажу и строки, посчитать итог на сервере (`line_total = qty * unit_price`).
4. Через `post_movements` записать движения с минусом и обновить остатки: он блокирует строки
   `stock_balances` (`SELECT ... FOR UPDATE`, по возрастанию product_id) и при нехватке бросает
   409 «Недостаточно товара. OC-90: на остатке 2, требуется 3». Транзакция откатывается целиком,
   продажа не остаётся.
5. Номер берётся из `document_counters` при создании продажи (шаг 3), поэтому неудачная
   продажа номер не расходует. Один commit, ответ 201. Если два одинаковых запроса пришли одновременно, второй получает
   нарушение `uq_sales_request_id`, откатывается и возвращает продажу первого (шаг 1).

### Отмена документа
Продажа: статус 'cancelled', обратные движения 'sale_cancel'. Повторная отмена запрещена.
Приход: то же с 'receipt_cancel', но если товар уже продан и остаток уйдёт в минус, отмена запрещена
с понятным сообщением.

## API v1

```
GET    /api/health
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/products?q=&include_archived=
POST   /api/products
GET    /api/products/{id}
PATCH  /api/products/{id}               артикул, название, бренд, цена, заметка, архив (не остаток)
GET    /api/products/{id}/movements     история движений, новые сверху, с balance_after

GET    /api/customers?q=                имя или телефон; цифры телефона сравниваются без 7/8 в начале
POST   /api/customers
GET    /api/customers/{id}
PATCH  /api/customers/{id}

POST   /api/receipts
GET    /api/receipts?date_from=&date_to=&status=   даты YYYY-MM-DD по Asia/Almaty, date_to включительно
GET    /api/receipts/{id}
POST   /api/receipts/{id}/cancel

POST   /api/stock/adjustments           корректировка остатка с обязательной причиной

POST   /api/sales                       201 новая продажа, 200 повтор с тем же request_id
GET    /api/sales?date_from=&date_to=&customer_id=&status=   как у приходов, плюс sum_posted
GET    /api/sales/{id}
POST   /api/sales/{id}/cancel

GET    /api/settings                    (Шаг 12)
PUT    /api/settings                    (Шаг 12)
```

Id в пути, в query и в теле запроса: целое от 1 до 9223372036854775807 (тип `DbId`
в `app/schema_types.py`). Больше или меньше — 422.

### Формат ошибок API

Каждый ответ 4xx содержит `detail` (русский текст для пользователя) и `code` (машинный код
в snake_case). Фронтенд принимает решения только по `code`; `detail` показывает как есть.
Схема тела `ErrorOut` и список кодов `ErrorCode` есть в OpenAPI (ответ `4XX` у каждого эндпоинта),
на фронтенд они попадают через `make gen-api`.

Бизнес-ошибка (`AppError` из `app/errors.py`): текст и код. Код задаётся атрибутом `code`
у класса исключения; у каждого наследника `AppError` свой код (проверяет тест).

```json
{"detail": "Товар OC-90 в архиве", "code": "product_archived"}
```

Ошибка валидации запроса (422 от Pydantic): общий текст, код `validation_error` и список полей.

```json
{
  "detail": "Проверьте введённые данные",
  "code": "validation_error",
  "errors": [
    {"field": "lines.0.qty", "message": "Должно быть не меньше 1"},
    {"field": "note", "message": "Максимальная длина: 1000"}
  ]
}
```

`field` — путь к полю через точку; у полей тела без префикса `body`, у параметров пути и
строки запроса с префиксом (`path.sale_id`, `query.limit`), у тела целиком пустая строка.
`message` — русский текст; перевод типов ошибок Pydantic в `VALIDATION_MESSAGES`
(`app/errors.py`), неизвестный тип даёт «Некорректное значение».

Коды (новый код добавляется в `ErrorCode` и в эту таблицу, тест сверяет список):

| Код | HTTP | Когда |
|---|---|---|
| `validation_error` | 422 | запрос не прошёл проверку схемы (поля в `errors`) |
| `app_error` | 400 | базовый `AppError` без своего кода (не должен встречаться) |
| `not_authenticated` | 401 | нет сессии или она истекла |
| `invalid_credentials` | 401 | неверный логин или пароль |
| `too_many_login_attempts` | 429 | больше 5 неудачных входов в минуту |
| `username_taken` | 409 | логин уже занят (CLI) |
| `user_not_found` | 404 | пользователь не найден (CLI) |
| `invalid_user_data` | 422 | некорректные данные пользователя (CLI) |
| `invalid_article` | 422 | артикул пуст после нормализации |
| `product_not_found` | 404 | товар из адреса не найден |
| `duplicate_article` | 409 | товар с таким нормализованным артикулом уже есть |
| `product_archived` | 409 | товар в архиве, в документ его добавить нельзя |
| `customer_not_found` | 404 | покупатель из адреса не найден |
| `document_customer_not_found` | 422 | покупатель, указанный в продаже, не найден |
| `invalid_document_lines` | 422 | строки документа: товар не найден, повторяется, нет цены |
| `insufficient_stock` | 409 | не хватает товара на остатке |
| `receipt_not_found` | 404 | приход не найден |
| `receipt_already_cancelled` | 409 | приход уже отменён |
| `receipt_cancel_blocked` | 409 | отмена прихода увела бы остаток в минус |
| `sale_not_found` | 404 | продажа не найдена |
| `sale_already_cancelled` | 409 | продажа уже отменена |
| `sale_request_conflict` | 409 | `request_id` уже использован продажей с другим содержимым |
| `not_found` | 404 | неизвестный адрес (ответ самого FastAPI, «Не найдено») |
| `method_not_allowed` | 405 | метод не поддерживается для этого адреса (заголовок `Allow` сохраняется) |
| `http_error` | прочие | другая HTTP-ошибка фреймворка, «Ошибка запроса» |

Ответы самого FastAPI (неизвестный адрес, неверный метод) идут в том же формате: обработчик
`StarletteHTTPException` в `app/errors.py` подставляет русский текст и код из `HTTP_ERRORS`.
Неизвестный адрес под `/api` даёт 404, а не 401: маршрут ищется до проверки сессии.

## Фронтенд

Маршруты: `/login`, `/sale` (главный экран), `/products`, `/products/:id`, `/customers`,
`/customers/:id`, `/receipts`, `/receipts/new`, `/receipts/:id`, `/sales`, `/sales/:id`,
`/sales/:id/print`, `/settings`.

Главный экран продажи работает с клавиатуры: поле поиска артикула в фокусе, Enter добавляет товар,
количество и цена редактируются в строке, покупатель выбирается или создаётся тут же,
«Провести и напечатать» открывает накладную.

Каждая страница — отдельный чанк (`React.lazy` в `pages/lazyPages.tsx`), загружается при первом
заходе. Пока чанк грузится, `Suspense` показывает `PageLoader`: в `AppLayout` на месте
содержимого (меню остаётся), в `main.tsx` на весь экран (вход, печать накладной).

Накладная (`/sales/:id/print`) повторяет форму З-2 «Накладная на отпуск запасов на сторону»
(приложение 26 к приказу Министра финансов РК от 20.12.2012 № 562). Это отдельная страница вне
общего меню со стилями для печати A4 книжной (`InvoicePrintPage.css`: `@page`, повтор шапки
таблицы, строки не разрываются). Браузер печатает её или сохраняет в PDF. `?auto=1` открывает
диалог печати один раз после загрузки и убирает флаг из адреса. Реквизиты берутся из
`/api/settings`, количество и сумма прописью — `lib/amountInWords.ts`. Отменённая продажа
печатается с диагональной надписью «ОТМЕНЕНА».

## Безопасность

- Пароли: argon2. Вход ограничен: не больше 5 неудачных попыток в минуту с одного IP.
  Счётчик попыток хранится в памяти процесса, поэтому backend работает в одном процессе
  uvicorn (без `--workers N` и без нескольких реплик).
- Сессия: случайный токен в cookie `qoima_session` (`HttpOnly`, `SameSite=Lax`, `Secure` в продакшне), 30 дней без продления.
  В базе хранится только хэш токена.
- Изменяющие запросы принимают только JSON.
- PostgreSQL не доступен из интернета. Секреты только в `.env` (на сервере `deploy/.env.prod`),
  которые не попадают в git.
- IP клиента для лимита входа: uvicorn запущен с `--proxy-headers` и доверяет `X-Forwarded-For`
  только от контейнера Caddy (`FORWARDED_ALLOW_IPS`, фиксированный адрес в
  `deploy/docker-compose.prod.yml`). Caddy без `trusted_proxies` заменяет присланный клиентом
  `X-Forwarded-For` настоящим адресом, поэтому подделка заголовка лимит не обходит.
- Caddy добавляет HSTS, CSP, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy и убирает
  заголовок `Server`. На проде `ENABLE_DOCS=false`: `/docs`, `/redoc`, `/openapi.json` отключены.
- Сервер: SSH только по ключу, ufw (22, 80, 443), fail2ban, автоматические обновления безопасности.

## Бэкапы

Каждую ночь в 03:00 `deploy/backup.sh`: `pg_dump -Fc` (сжатый формат) из контейнера `db`,
шифрование `age` открытым ключом владельца, хранение 14 дней на сервере. Приватного ключа на
сервере нет. `deploy/pull-backups.sh` забирает бэкапы на компьютер владельца (rsync по SSH).
Раз в месяц пробное восстановление `deploy/restore.sh` в отдельную базу `qoima_restore_check`
со сверкой количества строк. Подробности в `deploy/README.md`.

## Хостинг

VPS у казахстанского провайдера: в базе имена и телефоны покупателей, это персональные данные.
1-2 vCPU, 2 ГБ RAM, Ubuntu 24.04, свой домен для HTTPS.

Продакшн-стек (`deploy/docker-compose.prod.yml`): `db` (postgres:17, volume, порт не публикуется),
`api` (`backend/Dockerfile`: python:3.12-slim, uv, непривилегированный пользователь; при старте
`alembic upgrade head`, затем один процесс uvicorn), `web` (`deploy/web.Dockerfile`: сборка
фронтенда в node, затем caddy:2-alpine со статикой и `deploy/Caddyfile`; порты 80, 443, 443/udp).
Установка на сервер по шагам: `deploy/README.md`.

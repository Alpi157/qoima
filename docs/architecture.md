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

### sessions
| поле | тип | заметки |
|---|---|---|
| token_hash | text unique not null | sha256 от токена, сам токен только в cookie |
| user_id | fk users | |
| created_at, expires_at, last_seen_at | timestamptz | срок 30 дней, продлевается при активности |

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
Одна запись «Основной», создаётся миграцией. Нужна, чтобы потом можно было добавить склады.

### receipts и receipt_lines (приход)
receipts: `number` (bigint unique из sequence), `received_at`, `supplier` (text null),
`note`, `status` ('posted' | 'cancelled'), `cancelled_at`, `cancelled_by`, `cancel_reason`,
`created_by`, `created_at`.

receipt_lines: `receipt_id`, `product_id`, `qty` (int, check > 0), `unit_cost` (bigint null, check >= 0).

Первое заполнение остатков делается обычным приходом с поставщиком «Начальные остатки».

### sales и sale_lines (продажа)
sales: `number` (bigint unique из sequence), `request_id` (uuid unique, защита от двойной отправки),
`customer_id` (null допустим), `sold_at`, `total` (bigint), `note`, `status` ('posted' | 'cancelled'),
`cancelled_at`, `cancelled_by`, `cancel_reason`, `created_by`, `created_at`.

sale_lines: `sale_id`, `product_id`, `qty` (int, check > 0), `unit_price` (bigint, check >= 0),
`line_total` (bigint). Цена подставляется из товара, но в строке её можно изменить.
Сохраняется та цена, по которой реально продали.

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
Одна строка: название продавца, ИИН/БИН, адрес, телефон, текст внизу накладной.

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
артикул содержит запрос, похожесть названия (pg_trgm). Архивные товары скрыты. Максимум 20 результатов.
В ответе есть остаток и цена.

### Проведение продажи (одна транзакция)
1. Если продажа с таким `request_id` уже есть, вернуть её и ничего не создавать.
2. Заблокировать строки `stock_balances` нужных товаров (`SELECT ... FOR UPDATE`, по возрастанию product_id).
3. Проверить остатки. Если не хватает, ошибка вида «OC90: на остатке 2, в продаже 3».
4. Создать продажу и строки, посчитать итог на сервере.
5. Через `post_movements` записать движения с минусом и обновить остатки.

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
GET    /api/products/{id}/movements

GET    /api/customers?q=
POST   /api/customers
GET    /api/customers/{id}
PATCH  /api/customers/{id}

POST   /api/receipts
GET    /api/receipts?from=&to=
GET    /api/receipts/{id}
POST   /api/receipts/{id}/cancel

POST   /api/stock/adjustments           корректировка остатка с обязательной причиной

POST   /api/sales
GET    /api/sales?from=&to=&customer_id=
GET    /api/sales/{id}
POST   /api/sales/{id}/cancel

GET    /api/settings                    (Шаг 12)
PUT    /api/settings                    (Шаг 12)
```

## Фронтенд

Маршруты: `/login`, `/sale` (главный экран), `/products`, `/products/:id`, `/customers`,
`/customers/:id`, `/receipts`, `/receipts/new`, `/receipts/:id`, `/sales`, `/sales/:id`,
`/sales/:id/print`, `/settings`.

Главный экран продажи работает с клавиатуры: поле поиска артикула в фокусе, Enter добавляет товар,
количество и цена редактируются в строке, покупатель выбирается или создаётся тут же,
«Провести и напечатать» открывает накладную.

Накладная это отдельная страница со стилями для печати. Браузер печатает её или сохраняет в PDF.

## Безопасность

- Пароли: argon2. Вход ограничен: не больше 5 попыток в минуту с одного IP.
- Сессия: случайный токен в cookie `HttpOnly`, `SameSite=Lax`, `Secure` в продакшне.
  В базе хранится только хэш токена.
- Изменяющие запросы принимают только JSON.
- PostgreSQL не доступен из интернета. Секреты только в `.env`, который не попадает в git.
- Сервер: SSH только по ключу, ufw (22, 80, 443), fail2ban, автоматические обновления безопасности.

## Бэкапы

Каждую ночь `pg_dump`, сжатие и шифрование, хранение 14 дней на сервере и копия вне VPS.
Раз в месяц пробное восстановление в отдельную базу.

## Хостинг

VPS у казахстанского провайдера: в базе имена и телефоны покупателей, это персональные данные.
1-2 vCPU, 2 ГБ RAM, Ubuntu 24.04, свой домен для HTTPS.

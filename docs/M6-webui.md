# M6: WebUI (Hono + HTMX)

HTML-дашборд для просмотра истории прогонов, метрик и исследования API.

## Быстрый старт

```bash
# Установить зависимость (уже добавлена)
bun add hono

# Запустить с OpenAPI спекой (URL или файл)
bun src/cli/index.ts serve --port 8080 --openapi https://petstore3.swagger.io/api/v3/openapi.json

# Запустить только с дашбордом (без Explorer)
bun src/cli/index.ts serve --port 8080

# Своя БД
bun src/cli/index.ts serve --port 8080 --db history.db
```

Открыть http://localhost:8080 в браузере.

---

## CLI: `apitool serve`

```
apitool serve [options]

  --port <port>      Порт сервера (default: 8080)
  --host <host>      Хост сервера (default: 0.0.0.0)
  --openapi <spec>   Путь к OpenAPI спеке или URL для Explorer
  --db <path>        Путь к SQLite БД (default: apitool.db)
```

---

## Страницы

| Route | Описание |
|-------|----------|
| `GET /` | Dashboard: карточки метрик, последние прогоны, медленные/flaky тесты |
| `GET /metrics` | HTML-фрагмент метрик (для HTMX auto-refresh) |
| `GET /runs` | Список прогонов с пагинацией (20 на страницу) |
| `GET /runs/:id` | Детали прогона: шаги по suite, expand failed шагов |
| `GET /explorer` | Дерево API из OpenAPI спеки, multi-auth panel, "Try it" формы |
| `GET /static/style.css` | CSS стили |
| `POST /api/run` | Запуск тестов из WebUI |
| `POST /api/try` | Единичный HTTP-запрос из Explorer (с auth injection) |
| `POST /api/authorize` | Proxy login для Bearer auth |

---

## Dashboard (`GET /`)

Карточки:
- **Total Runs** — количество завершённых прогонов
- **Total Tests** — сумма всех тестов по всем прогонам
- **Pass Rate** — `SUM(passed) * 100 / SUM(total)` (%)
- **Avg Duration** — среднее время прогона

Таблицы:
- **Recent Runs** (последние 5) — ID, дата, total/pass/fail/skip, duration, badge
- **Slowest Tests** (top 5) — suite, test, средняя длительность
- **Flaky Tests** (top 5) — тесты с разными статусами в последних 20 прогонах

Auto-refresh: `hx-trigger="every 10s"` на блоке метрик.

### SQL-запросы (добавлены в `src/db/queries.ts`)

| Функция | Описание |
|---------|----------|
| `getDashboardStats()` → `DashboardStats` | Агрегаты: totalRuns, totalTests, overallPassRate, avgDuration |
| `getPassRateTrend(limit)` → `PassRateTrendPoint[]` | Pass rate по последним N прогонам |
| `getSlowestTests(limit)` → `SlowestTest[]` | AVG(duration_ms) GROUP BY suite+test, ORDER BY DESC |
| `getFlakyTests(runsBack, limit)` → `FlakyTest[]` | Тесты с COUNT(DISTINCT status) > 1 |
| `countRuns()` → `number` | Общее количество записей в runs |

---

## Runs (`GET /runs`, `GET /runs/:id`)

### Список прогонов

Таблица с колонками: ID | Date | Total | Pass | Fail | Skip | Duration | Status badge.

Пагинация: `?page=N`, 20 записей на страницу. HTMX `hx-get` + `hx-push-url` для SPA-навигации.

### Детали прогона

- Шапка: ID, дата, environment, duration, totals (pass/fail/skip)
- Шаги сгруппированы по suite
- Каждый шаг: badge (✓/✗/○), имя, duration
- Клик на failed/error шаг раскрывает панель с:
  - Request method + URL
  - Error message (если error)
  - Список assertions (pass/fail с actual значениями)

---

## Explorer (`GET /explorer`)

### Без спеки

Если `--openapi` не указан — страница с сообщением и инструкцией.

### С OpenAPI спекой

- Спека загружается при старте сервера (файл или URL)
- Эндпоинты сгруппированы по `tags[0]`
- Каждый эндпоинт показывает: method badge (цветной), path, summary
- Клик раскрывает панель:
  - **Parameters** — таблица (name, in, required, type)
  - **Request Body** — JSON-схема (если есть)
  - **Responses** — таблица (status, description)
  - **Try it** — форма для отправки запроса

### Base URL из спеки

Поле `servers` из OpenAPI спеки подставляется автоматически (как в Swagger UI):
- 1 сервер → input с заполненным значением
- Несколько серверов → dropdown для выбора
- Нет серверов → пустое поле

### Authorize Panel (multi-scheme)

При наличии `securitySchemes` в OpenAPI спеке отображается панель авторизации с поддержкой нескольких схем одновременно.

**Credential Store** — глобальный объект `window.__authCredentials`, хранящий активные авторизации по имени схемы. HTMX-хук `htmx:configRequest` автоматически инжектит все активные credentials в каждый `/api/try` запрос.

**Поддерживаемые типы:**

| Тип | UI | Поведение |
|-----|-----|-----------|
| `http/bearer` | Поле для прямого токена + login-proxy (если `loginPath`) | `Authorization: Bearer <token>` |
| `http/basic` | Username + password | Клиентский `btoa(user:pass)` → `Authorization: Basic <encoded>` |
| `apiKey` | Поле для значения, badge с расположением | Header или query param по спеке |
| `oauth2`, `openIdConnect` | Имя + "Not yet supported" | — |

**Per-scheme статус:** каждая схема показывает badge "Active" после применения. Глобальный счётчик показывает количество активных схем.

**Функции:**
- `applyBearerDirect(name)` — прямой токен
- `doLoginProxy(name, loginPath)` — proxy через `/api/authorize`
- `applyApiKey(name, location, keyName)` — header или query
- `applyBasic(name)` — `btoa(user:pass)`

### POST /api/authorize

Proxy для Bearer auth через login endpoint.

**Body (JSON):**
```json
{
  "base_url": "http://localhost:3000",
  "path": "/auth/login",
  "username": "admin",
  "password": "secret"
}
```

**Поведение:**
1. Отправляет POST `base_url + path` с `{username, password}`
2. Ищет `token` или `access_token` в JSON-ответе
3. Возвращает `{token}` или `{error}`

### Try it (`POST /api/try`)

Форма собирает:
- Base URL (из servers или вручную)
- Path parameters → подставляются в URL `{param}`
- Query parameters → добавляются к URL
- Header parameters → отправляются как заголовки
- Auth credentials → инжектятся через HTMX-хук из credential store
- Body (JSON) → отправляется как request body

Ответ вставляется через HTMX: статус (цветной), заголовки (collapsible), тело (pretty JSON).

---

## API (`POST /api/run`, `POST /api/try`)

### POST /api/run

Запуск тестов из WebUI.

**Body (JSON):**
```json
{
  "path": "tests/",
  "env": "staging"
}
```

**Поведение:**
1. `parse(path)` → `loadEnvironment()` → `runSuite()` для каждого suite
2. Результаты сохраняются в БД (trigger: "webui")
3. Возвращает `HX-Redirect: /runs/:id` для перенаправления

### POST /api/try

Единичный HTTP-запрос из Explorer.

**Поддерживает два формата входа:**
- `application/x-www-form-urlencoded` (от HTMX форм)
- `application/json`

**Возвращает HTML-фрагмент** (для вставки через HTMX):
- Статус с цветом (2xx=зелёный, 4xx=оранжевый, 5xx=красный)
- Headers (в `<details>`)
- Body (pretty-printed JSON если возможно)

---

## Архитектура

### Файловая структура

```
src/web/
├── server.ts          # Hono app, static serving, startServer()
├── routes/
│   ├── dashboard.ts   # GET /, GET /metrics
│   ├── runs.ts        # GET /runs, GET /runs/:id
│   ├── explorer.ts    # GET /explorer
│   └── api.ts         # POST /api/run, POST /api/try
├── views/
│   └── layout.ts      # HTML layout, escapeHtml()
└── static/
    └── style.css      # CSS (dark/light, responsive)
```

### Стилизация

Один CSS файл без фреймворков:
- CSS variables для цветов (pass/fail/skip/error)
- `prefers-color-scheme: dark` для автоматической тёмной темы
- Responsive через `max-width: 1100px`
- Компоненты: cards, tables, badges, progress bar, forms

### HTMX-паттерны

- `hx-get` + `hx-target="main"` + `hx-push-url="true"` — SPA-навигация без перезагрузки
- `hx-trigger="every 10s"` — авто-обновление метрик
- `hx-post` + `hx-target="#response-N"` — отправка Try it формы
- `HX-Request: true` header — сервер возвращает фрагмент вместо полной страницы

### Программное использование

```typescript
import { createApp } from "./src/web/server.ts";
import { startServer } from "./src/web/server.ts";

// Для тестов — без поднятия сервера
const app = createApp({ endpoints: [], specPath: null, servers: [], securitySchemes: [], loginPath: null });
const response = await app.request("/");

// Запуск сервера
await startServer({ port: 8080, openapiSpec: "api.yaml" });
```

---

## Тесты

```bash
bun test tests/web/routes.test.ts      # 11 тестов роутов
bun test tests/web/explorer.test.ts    # 14 тестов Explorer
bun test tests/db/queries.test.ts      # dashboard-метрики (8 тестов)

bun test tests/web/ tests/db/          # все web + db тесты
```

### Покрытие

| Файл | Тесты |
|------|-------|
| `web/routes.test.ts` | Dashboard 200, metrics fragment, runs list, run details, 404/400, static CSS, HTMX fragments, pagination |
| `web/explorer.test.ts` | No-spec message, endpoint tree, tag grouping, parameters, request body, pre-filled server URL, HTMX fragment, bearer auth panel, API Key rendering, Basic auth rendering, multi-scheme, oauth2 unsupported, bearer without loginPath |
| `db/queries.test.ts` | getDashboardStats (zeros, aggregates), getPassRateTrend, getSlowestTests, getFlakyTests, countRuns |

Hono позволяет тестировать без поднятия HTTP-сервера: `app.request(path)` возвращает стандартный `Response`.

---

## Зависимости

| Пакет | Версия | Назначение |
|-------|--------|------------|
| `hono` | 4.12.2 | HTTP-сервер, роутинг |
| HTMX | 2.0.4 (CDN) | Интерактивность без JS-фреймворка |

Нет сборщиков, бандлеров, node_modules для фронта. HTMX подключается через CDN `<script>`.

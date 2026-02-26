# APITOOL

**API Testing Platform** — CLI + WebUI для тестирования API из одного бинарника.

OpenAPI спецификация → рабочие тесты + тест-кейсы + дашборд. Один файл. Ноль настроек.

---

## Стек

| Компонент | Технология |
|-----------|-----------|
| Runtime | Bun |
| Язык | TypeScript (strict) |
| HTTP-клиент | `fetch` (Bun native) |
| БД | SQLite (`bun:sqlite`) |
| Веб-сервер | Hono |
| Frontend | HTMX + минимальный CSS |
| OpenAPI парсер | `@readme/openapi-parser` |
| Формат тестов | YAML |
| Сборка | `bun build --compile` |

---

## Структура проекта

```
apitool/
├── src/
│   ├── core/
│   │   ├── parser/
│   │   │   ├── yaml-parser.ts      # Парсинг YAML → TestSuite
│   │   │   ├── schema.ts           # JSON Schema для валидации
│   │   │   ├── variables.ts        # Подстановка {{var}}, {{$generators}}
│   │   │   └── types.ts            # TestSuite, TestStep, Assertion, Capture
│   │   ├── runner/
│   │   │   ├── http-client.ts      # fetch-обёртка с таймаутами и retry
│   │   │   ├── executor.ts         # Выполнение TestSuite, цепочки captures
│   │   │   ├── assertions.ts       # Проверка ассертов (status, jsonpath, regex, type)
│   │   │   └── types.ts            # TestRunResult, StepResult
│   │   ├── generator/
│   │   │   ├── openapi-reader.ts   # Парсинг OpenAPI 3.x
│   │   │   ├── skeleton.ts         # Уровень 1: один запрос на эндпоинт
│   │   │   ├── crud.ts             # Уровень 2: CRUD-цепочки
│   │   │   ├── testcases.ts        # Уровень 3: Markdown тест-кейсы
│   │   │   └── data-factory.ts     # Генерация тестовых данных по схеме
│   │   └── reporter/
│   │       ├── json.ts             # JSON-отчёт
│   │       ├── junit.ts            # JUnit XML
│   │       └── console.ts          # Цветной вывод в терминал
│   ├── db/
│   │   ├── schema.ts               # Создание таблиц, миграции
│   │   └── queries.ts              # CRUD-операции с историей прогонов
│   ├── web/
│   │   ├── server.ts               # Hono-сервер
│   │   ├── routes/
│   │   │   ├── dashboard.ts        # GET / — главная
│   │   │   ├── runs.ts             # GET /runs, GET /runs/:id
│   │   │   ├── explorer.ts         # GET /explorer — дерево API
│   │   │   └── api.ts              # POST /api/run, POST /api/try
│   │   ├── views/                  # HTML-шаблоны (JSX или template literals)
│   │   └── static/                 # HTMX, CSS, иконки
│   └── cli/
│       ├── index.ts                # Точка входа, роутинг команд
│       ├── commands/
│       │   ├── run.ts              # apitool run
│       │   ├── generate.ts         # apitool generate
│       │   ├── describe.ts         # apitool describe
│       │   ├── serve.ts            # apitool serve
│       │   ├── validate.ts         # apitool validate
│       │   └── init.ts             # apitool init
│       └── output.ts              # Форматирование CLI-вывода
├── tests/                          # Тесты самого инструмента
├── examples/                       # Примеры YAML-тестов
├── docs/                           # Документация
├── package.json
├── tsconfig.json
└── bunfig.toml
```

---

## Модули

### M1: Parser (`src/core/parser/`)

Читает YAML-файлы, валидирует, возвращает типизированные структуры.

**Вход:** путь к `.yaml` файлу или директории.
**Выход:** `TestSuite[]`

Ключевые типы:

```typescript
interface TestSuite {
  name: string;
  base_url?: string;
  headers?: Record<string, string>;      // общие заголовки для всех тестов
  tests: TestStep[];
}

interface TestStep {
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  headers?: Record<string, string>;
  json?: unknown;                         // тело запроса
  form?: Record<string, string>;          // form-urlencoded
  query?: Record<string, string>;         // query-параметры
  expect: {
    status?: number;
    body?: Record<string, AssertionRule>;  // JSONPath-подобные проверки
    headers?: Record<string, string>;
    duration?: number;                    // максимальное время ответа (мс)
  };
}

interface AssertionRule {
  capture?: string;       // сохранить значение в переменную
  type?: "string" | "integer" | "number" | "boolean" | "array" | "object";
  equals?: unknown;       // точное совпадение
  contains?: string;      // строка содержит подстроку
  matches?: string;       // regex
  gt?: number;            // больше
  lt?: number;            // меньше
  exists?: boolean;       // поле существует / не существует
}
```

Встроенные генераторы переменных:

| Генератор | Пример значения |
|-----------|----------------|
| `{{$randomName}}` | "John Smith" |
| `{{$randomEmail}}` | "xk92m@test.com" |
| `{{$uuid}}` | "550e8400-e29b-41d4-a716-446655440000" |
| `{{$timestamp}}` | 1708876800 |
| `{{$randomInt}}` | 42 |
| `{{$randomString}}` | "aBcDeFgH" |

Environments — файлы `.env.yaml`:

```yaml
# .env.yaml (по умолчанию)
base: http://localhost:3000/api
token: dev-token-123

# .env.staging.yaml
base: https://staging.example.com/api
token: staging-token-456
```

Использование: `apitool run tests/ --env staging`

---

### M2: Runner (`src/core/runner/`)

Выполняет `TestSuite`, отправляет HTTP-запросы, проверяет ассерты, передаёт captures между шагами.

**Вход:** `TestSuite` + `Environment`
**Выход:** `TestRunResult`

```typescript
interface TestRunResult {
  suite_name: string;
  started_at: string;         // ISO 8601
  finished_at: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  steps: StepResult[];
}

interface StepResult {
  name: string;
  status: "pass" | "fail" | "skip" | "error";
  duration_ms: number;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    body: string;                     // сырой текст (для отчёта)
    body_parsed?: unknown;            // JSON если application/json
  };
  assertions: AssertionResult[];
  captures: Record<string, unknown>;  // извлечённые значения
  error?: string;                     // если error/skip — причина
}

interface AssertionResult {
  field: string;          // "status" | "body.id" | "headers.content-type"
  rule: string;           // "equals 201" | "type integer" | "matches .*@.*"
  passed: boolean;
  actual: unknown;
  expected: unknown;
}
```

Логика выполнения:

1. Подставить переменные окружения и captures в URL, headers, body
2. Отправить HTTP-запрос (fetch)
3. Извлечь captures из ответа
4. Проверить все ассерты
5. Если шаг упал и он имеет `capture` — последующие шаги, зависящие от этой переменной, получают `status: skip`

Параллельность: файлы (suites) выполняются параллельно, шаги внутри suite — последовательно (из-за captures).

Конфигурация:

```yaml
# в YAML-тесте или глобально
config:
  timeout: 30000        # мс, таймаут на один запрос
  retries: 0            # количество повторов при ошибке
  retry_delay: 1000     # задержка между повторами
  follow_redirects: true
  verify_ssl: true
```

---

### M3: Generator (`src/core/generator/`)

Читает OpenAPI 3.x, генерирует YAML-тесты и Markdown тест-кейсы.

**Вход:** OpenAPI 3.x YAML/JSON
**Выход:** `.yaml` файлы тестов + `.md` файл тест-кейсов

#### Уровень 1 — Skeleton

Один тест на каждый `path + method`. Генерирует тело запроса из `requestBody.content.application/json.schema`, ассерты из `responses`.

Auth-aware генерация: при наличии security schemes автоматически добавляет:
- **Bearer** — login-шаг с capture `auth_token` + suite-level `Authorization: Bearer {{auth_token}}`
- **API Key** — suite-level header `X-API-Key: {{apikeyauth}}` (env-переменная из имени схемы)
- **Basic** — suite-level header `Authorization: Basic {{basic_credentials}}`

```yaml
# Сгенерировано из: POST /users
name: "POST /users — 201"
POST: /users
json:
  name: "{{$randomName}}"
  email: "{{$randomEmail}}"
expect:
  status: 201
  body:
    id: { type: integer }
    name: { type: string }
    email: { type: string }
```

#### Уровень 2 — CRUD-цепочки

Автоматическое распознавание паттернов:
- `POST /resources` + `GET /resources/{id}` + `PUT /resources/{id}` + `DELETE /resources/{id}` → CRUD suite
- Связывание через `capture` из POST → подстановка в GET/PUT/DELETE

#### Уровень 3 — Текстовые тест-кейсы

```markdown
## POST /users — Create User

### TC-001: Успешное создание
- **Шаги:** POST /users с валидным телом {name, email}
- **Ожидание:** Status 201, тело содержит id (number), name и email совпадают с отправленными
- **Приоритет:** High

### TC-002: Отсутствует обязательное поле name
- **Шаги:** POST /users без поля name
- **Ожидание:** Status 400 или 422, тело содержит описание ошибки
- **Приоритет:** High

### TC-003: Невалидный email
- **Шаги:** POST /users с email = "not-an-email"
- **Ожидание:** Status 400 или 422
- **Приоритет:** Medium
```

---

### M4: Reporter (`src/core/reporter/`)

Формирует отчёты из `TestRunResult`.

**JSON** — полный дамп `TestRunResult`, сохраняется в SQLite.

**JUnit XML** — для CI:

```xml
<testsuites tests="5" failures="1" time="2.34">
  <testsuite name="Users CRUD" tests="5" failures="1">
    <testcase name="Create user" time="0.45"/>
    <testcase name="Get user" time="0.12"/>
    <testcase name="Update user" time="0.31">
      <failure message="Expected status 200, got 500">...</failure>
    </testcase>
  </testsuite>
</testsuites>
```

**Console** — цветной вывод:

```
 Users CRUD
  ✓ Create user (450ms)
  ✓ Get user (120ms)
  ✗ Update user (310ms)
    Expected status 200, got 500
  ✓ Delete user (89ms)
  ○ Verify deleted (skipped)

Results: 3 passed, 1 failed, 1 skipped (1.2s)
```

---

### M5: Storage (`src/db/`)

SQLite через `bun:sqlite`. Файл `apitool.db` создаётся автоматически при первом запуске.

```sql
CREATE TABLE runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    TEXT NOT NULL,          -- ISO 8601
  finished_at   TEXT,
  total         INTEGER NOT NULL DEFAULT 0,
  passed        INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  skipped       INTEGER NOT NULL DEFAULT 0,
  trigger       TEXT DEFAULT 'manual',  -- manual | ci | scheduled
  commit_sha    TEXT,
  branch        TEXT,
  environment   TEXT,
  duration_ms   INTEGER
);

CREATE TABLE results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES runs(id),
  suite_name    TEXT NOT NULL,
  test_name     TEXT NOT NULL,
  status        TEXT NOT NULL,          -- pass | fail | skip | error
  duration_ms   INTEGER NOT NULL,
  request_method TEXT,
  request_url   TEXT,
  request_body  TEXT,
  response_status INTEGER,
  response_body TEXT,                   -- хранить только при fail (экономия)
  error_message TEXT,
  assertions    TEXT                    -- JSON массив AssertionResult[]
);

CREATE TABLE environments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  variables     TEXT NOT NULL           -- JSON
);

-- Индексы для дашборда
CREATE INDEX idx_runs_started ON runs(started_at DESC);
CREATE INDEX idx_results_run ON results(run_id);
CREATE INDEX idx_results_status ON results(status);
CREATE INDEX idx_results_name ON results(suite_name, test_name);
```

Миграции: массив SQL-строк с номером версии. При старте проверяется `PRAGMA user_version`, применяются недостающие миграции.

---

### M6: WebUI (`src/web/`)

Запускается командой `apitool serve --port 8080`.

Hono-сервер рендерит HTML, интерактивность через HTMX.

**Страницы:**

| Route | Описание |
|-------|----------|
| `GET /` | Dashboard: pass rate, тренды, последний прогон, top-5 медленных, top-5 flaky |
| `GET /runs` | Список прогонов (таблица с пагинацией) |
| `GET /runs/:id` | Детали прогона: каждый тест → запрос/ответ/ассерты |
| `GET /explorer` | Дерево API из OpenAPI, параметры, описания, multi-auth panel |
| `POST /api/run` | Запустить прогон из WebUI (HTMX) |
| `POST /api/try` | Отправить единичный запрос из Explorer (HTMX, с auth injection) |
| `POST /api/authorize` | Proxy login для Bearer auth (username/password → token) |

Dashboard-метрики (SQL-запросы):

- **Pass rate trend:** последние 30 прогонов, `passed / total * 100`
- **Flaky-тесты:** тесты с разным статусом в последних N прогонах
- **Средняя длительность:** `AVG(duration_ms)` по тестам
- **Самые медленные:** `ORDER BY duration_ms DESC LIMIT 5`

Статика: HTMX (CDN или вкомпилирован), CSS (один файл, без фреймворков).

---

### M7: CLI (`src/cli/`)

| Команда | Описание | Основные флаги |
|---------|----------|----------------|
| `run <path>` | Запуск тестов | `--env`, `--report json\|junit\|console`, `--parallel`, `--timeout`, `--bail`, `--auth-token` |
| `generate` | Генерация тестов из OpenAPI | `--from <spec>`, `--output <dir>`, `--level skeleton\|crud\|all` |
| `describe` | Генерация Markdown тест-кейсов | `--from <spec>`, `--output <file>` |
| `serve` | Запуск WebUI | `--port`, `--host`, `--tests <dir>`, `--openapi <spec>` |
| `validate` | Проверка YAML-тестов | `<path>` |
| `init` | Создание структуры проекта | — |

Exit codes: `0` — все тесты прошли, `1` — есть падения, `2` — ошибка конфигурации.

---

## Формат YAML-тестов

### Минимальный пример

```yaml
name: Health Check
tests:
  - name: "API is alive"
    GET: /health
    expect:
      status: 200
```

### Полный пример (CRUD-цепочка)

```yaml
name: Users CRUD
base_url: "{{base}}"
headers:
  Authorization: "Bearer {{token}}"
  Content-Type: application/json

config:
  timeout: 10000
  retries: 1

tests:
  - name: "Create user"
    POST: /users
    json:
      name: "{{$randomName}}"
      email: "{{$randomEmail}}"
    expect:
      status: 201
      body:
        id: { capture: user_id, type: integer }
        name: { type: string }
      duration: 2000

  - name: "Get created user"
    GET: /users/{{user_id}}
    expect:
      status: 200
      body:
        id: { equals: "{{user_id}}" }
        email: { matches: ".+@.+" }

  - name: "Update user"
    PUT: /users/{{user_id}}
    json:
      name: "Updated Name"
    expect:
      status: 200
      body:
        name: { equals: "Updated Name" }

  - name: "List users"
    GET: /users
    query:
      page: "1"
      limit: "10"
    expect:
      status: 200
      body:
        data: { type: array }
        total: { type: integer, gt: 0 }

  - name: "Delete user"
    DELETE: /users/{{user_id}}
    expect:
      status: 204

  - name: "Verify deleted"
    GET: /users/{{user_id}}
    expect:
      status: 404
```

---

## Поток данных

```
                    CLI                         WebUI
                     │                            │
                     ▼                            ▼
               ┌──────────┐                ┌───────────┐
               │ Commands │                │   Hono    │
               └────┬─────┘                └─────┬─────┘
                    │                            │
                    ▼                            ▼
              ┌───────────────────────────────────────┐
              │              Core Engine               │
              │                                        │
              │  ┌──────────┐  ┌──────────┐           │
              │  │  Parser  │→ │  Runner  │           │
              │  └──────────┘  └────┬─────┘           │
              │                     │                  │
              │  ┌──────────┐  ┌────▼─────┐           │
              │  │Generator │  │ Reporter │           │
              │  └──────────┘  └────┬─────┘           │
              └─────────────────────┼──────────────────┘
                                    │
                              ┌─────▼─────┐
                              │  Storage  │
                              │  (SQLite) │
                              └───────────┘
```

---

## Roadmap (MVP)

| Модуль | Статус | Коммит | Результат |
|--------|--------|--------|-----------|
| M1 (Parser) + M2 (Runner) | DONE | `4e270ab` | `apitool run test.yaml` работает |
| M3 (Generator) | DONE | `e3d94d8` | `apitool generate --from api.yaml` — skeleton тесты |
| M4 (Reporter) + M7 (CLI basic) | DONE | `e179180` | console/json/junit отчёты, CLI команды |
| M5 (Storage/SQLite) | DONE | `2245e79` | История прогонов в apitool.db |
| M6 (WebUI) | DONE | `94a58e4` | `apitool serve --port 8080 --openapi <spec>`, multi-auth panel |
| M7 (CLI polish) | PARTIAL | — | Базовые команды + `--auth-token`, см. BACKLOG |
| M8 (Сборка + публикация) | TODO | — | `bun compile`, GitHub Release, README |

---

## Сборка

```bash
# Разработка
bun run src/cli/index.ts run tests/

# Компиляция в бинарник
bun build --compile src/cli/index.ts --outfile apitool

# Результат: один файл ~50-80 MB
./apitool run tests/*.yaml
./apitool serve --port 8080
```

---

## Принципы

1. **Один файл** — скачал бинарник, запустил, работает. Без Docker, без apt install.
2. **Тесты как код** — YAML в git, code review, merge requests.
3. **OpenAPI-first** — спецификация есть → тесты генерируются.
4. **Два режима** — CLI для CI/CD, WebUI для команды. Одна кодовая база.
5. **SQLite по умолчанию** — история работает из коробки, без настройки БД.

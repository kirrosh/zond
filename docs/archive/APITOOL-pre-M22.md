# APITOOL

**API Testing Platform** — CLI + WebUI для тестирования API из одного бинарника.

OpenAPI спецификация → AI-генерация тестов + дашборд + MCP для AI-агентов. Один файл. Ноль настроек.

---

## Содержание

- [Стек](#стек)
- [Структура проекта](#структура-проекта)
- [Модули](#модули)
  - [M1: Parser](#m1-parser-srcoreparser)
  - [M2: Runner](#m2-runner-srcorerunner)
  - [M3: Generator](#m3-generator-scoregenerator)
  - [M4: Reporter](#m4-reporter-srcorereporter)
  - [M5: Storage](#m5-storage-srcdb)
  - [M6: WebUI](#m6-webui-srcweb)
  - [M7: CLI](#m7-cli-srccli)
  - [M10: AI Generation](#m10-ai-generation-srccoregeneratorai)
  - [Agent — AI Chat](#agent--ai-chat)
- [Формат YAML-тестов](#формат-yaml-тестов)
- [Поток данных](#поток-данных)
- [Roadmap](#roadmap-mvp)
- [Сборка и установка](#сборка-и-установка)
- [Принципы](#принципы)

---

## Стек

| Компонент | Технология |
|-----------|-----------|
| Runtime | Bun |
| Язык | TypeScript (strict) |
| HTTP-клиент | `fetch` (Bun native) |
| БД | SQLite (`bun:sqlite`) |
| Веб-сервер | Hono + `@hono/zod-openapi` |
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
│   │   │   ├── execute-run.ts      # Shared executeRun() — парсинг, запуск, сохранение
│   │   │   ├── assertions.ts       # Проверка ассертов (status, jsonpath, regex, type)
│   │   │   └── types.ts            # TestRunResult, StepResult
│   │   ├── generator/
│   │   │   ├── openapi-reader.ts   # Парсинг OpenAPI 3.x
│   │   │   ├── serializer.ts       # RawSuite → YAML сериализация, sanitizeEnvName
│   │   │   ├── coverage-scanner.ts # Сканер покрытия для инкрементальной генерации
│   │   │   ├── data-factory.ts     # Генерация тестовых данных по схеме
│   │   │   └── ai/                 # AI-генерация тестов (M10)
│   │   │       ├── ai-generator.ts   # Оркестратор: spec → prompt → LLM → YAML
│   │   │       ├── llm-client.ts     # HTTP-клиент для LLM провайдеров
│   │   │       ├── prompt-builder.ts # Сборка системного + user промпта
│   │   │       ├── output-parser.ts  # Парсинг JSON-ответа LLM → TestSuite
│   │   │       └── types.ts          # AIGenerateOptions, AIGenerateResult
│   │   └── agent/                    # AI Chat Agent (AI SDK v6)
│   │       ├── agent-loop.ts         # generateText + tools + stopWhen
│   │       ├── context-manager.ts    # Автосжатие длинных диалогов
│   │       ├── system-prompt.ts      # Системный промпт с примерами tools
│   │       ├── types.ts              # AgentConfig, ToolEvent, AgentTurnResult
│   │       └── tools/                # 7 tools как AI SDK tool()
│   │   └── reporter/
│   │       ├── json.ts             # JSON-отчёт
│   │       ├── junit.ts            # JUnit XML
│   │       └── console.ts          # Цветной вывод в терминал
│   ├── db/
│   │   ├── schema.ts               # Создание таблиц, миграции
│   │   └── queries.ts              # CRUD-операции с историей прогонов
│   ├── web/
│   │   ├── server.ts               # OpenAPIHono-сервер, /api/openapi.json
│   │   ├── schemas.ts              # Zod-схемы для API (валидация + OpenAPI)
│   │   ├── routes/
│   │   │   ├── dashboard.ts        # GET / — главная с trend chart, коллекциями
│   │   │   ├── collections.ts      # GET /collections/:id, POST/DELETE /api/collections
│   │   │   ├── suites.ts          # GET /collections/:id/suites, detail — test file browser
│   │   │   ├── ai-generate.ts     # POST /api/ai-generate, save, GET /api/ai-generation/:id
│   │   │   ├── runs.ts             # GET /runs (с фильтрами), GET /runs/:id
│   │   │   ├── environments.ts    # CRUD окружений: list, detail, create, update, delete
│   │   │   ├── explorer.ts         # GET /explorer — дерево API
│   │   │   └── api.ts              # POST /api/run, POST /api/try, GET /api/export
│   │   ├── views/
│   │   │   ├── layout.ts           # HTML layout, escapeHtml()
│   │   │   └── trend-chart.ts      # Shared SVG trend chart component
│   │   └── static/                 # HTMX, CSS, иконки
│   ├── mcp/                        # MCP Server — AI-agent integration (M15)
│   │   ├── server.ts               # McpServer setup + stdio transport
│   │   └── tools/
│   │       ├── run-tests.ts        # run_tests — запуск тестов
│   │       ├── validate-tests.ts   # validate_tests — валидация YAML
│   │       ├── list-collections.ts # list_collections — список коллекций
│   │       ├── list-runs.ts        # list_runs — список прогонов
│   │       ├── get-run-results.ts  # get_run_results — детали прогона
│   │       ├── list-environments.ts # list_environments — список окружений
│   │       ├── send-request.ts     # send_request — ad-hoc HTTP запросы
│   │       ├── explore-api.ts      # explore_api — просмотр OpenAPI спеки
│   │       ├── manage-environment.ts # manage_environment — CRUD окружений
│   │       ├── diagnose-failure.ts # diagnose_failure — диагностика падений
│   │       └── coverage-analysis.ts # coverage_analysis — анализ покрытия
│   └── cli/
│       ├── index.ts                # Точка входа, роутинг команд, --api резолвинг
│       ├── commands/
│       │   ├── add-api.ts          # apitool add-api — регистрация нового API
│       │   ├── run.ts              # apitool run
│       │   ├── ai-generate.ts      # apitool ai-generate
│       │   ├── collections.ts      # apitool collections
│       │   ├── serve.ts            # apitool serve
│       │   ├── validate.ts         # apitool validate
│       │   ├── mcp.ts              # apitool mcp
│       │   ├── request.ts          # apitool request
│       │   ├── envs.ts             # apitool envs (--api для scoped envs)
│       │   ├── runs.ts             # apitool runs
│       │   ├── coverage.ts         # apitool coverage
│       │   ├── chat.ts             # apitool chat
│       │   ├── init.ts             # apitool init
│       │   ├── doctor.ts           # apitool doctor
│       │   └── update.ts           # apitool update
│       ├── runtime.ts             # Определение standalone vs dev режима
│       └── output.ts              # Форматирование CLI-вывода
├── tests/                          # Тесты самого инструмента
├── self-tests/                     # Сгенерированные skeleton-тесты для apitool API
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

При парсинге директории невалидные файлы пропускаются (один сломанный файл не блокирует остальные). Каждый распарсенный suite получает `_source` — путь к исходному файлу (используется для AI badge в WebUI).

Функция `parseDirectorySafe(dirPath)` возвращает `{ suites: TestSuite[], errors: { file: string, error: string }[] }` — собирает ошибки парсинга вместо их игнорирования. Используется в WebUI для показа broken-файлов. Функции `parse()` / `parseDirectory()` не изменены (обратная совместимость).

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

Environments — файлы `.env.yaml` и/или DB:

```yaml
# .env.yaml (по умолчанию)
base_url: http://localhost:3000/api
token: dev-token-123

# .env.staging.yaml
base_url: https://staging.example.com/api
token: staging-token-456
```

Использование: `apitool run tests/ --env staging` или `apitool run --api myapi --env staging`

**Приоритет резолва переменных:** файл `.env.<name>.yaml` > DB scoped env (привязан к коллекции) > DB global env (collection_id IS NULL) > генераторы > оставить `{{raw}}`

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

Утилиты для работы с OpenAPI и генерации тестов. Шаблонная генерация (CRUD/skeleton) удалена — остались только AI-генерация и вспомогательные модули.

- `openapi-reader.ts` — парсинг OpenAPI 3.x (файл или URL), `readOpenApiSpec()`, `extractEndpoints()`, `extractSecuritySchemes()`
- `serializer.ts` — конвертирует `RawSuite` в YAML формат, содержит `sanitizeEnvName()`
- `coverage-scanner.ts` — анализ покрытия: `scanCoveredEndpoints()`, `filterUncoveredEndpoints()`
- `data-factory.ts` — генерация тестовых данных по JSON Schema
- `ai/` — AI-генерация тестов (см. [M10: AI Generation](#m10-ai-generation-srccoregeneratorai))

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
CREATE TABLE collections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  base_dir     TEXT,                    -- корневая директория коллекции
  test_path    TEXT NOT NULL,           -- абсолютный путь к тестам (forward slashes)
  openapi_spec TEXT,                    -- путь к OpenAPI спеке
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

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
  duration_ms   INTEGER,
  collection_id INTEGER REFERENCES collections(id)  -- nullable, привязка к коллекции
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
  assertions    TEXT,                   -- JSON массив AssertionResult[]
  captures      TEXT                    -- JSON Record<string, unknown>
);

CREATE TABLE environments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
  variables     TEXT NOT NULL           -- JSON
);
-- Уникальность: (name, collection_id) — scoped к коллекции
-- + отдельный индекс для глобальных (collection_id IS NULL)
CREATE UNIQUE INDEX idx_env_name_collection ON environments(name, collection_id);
CREATE UNIQUE INDEX idx_env_name_global ON environments(name) WHERE collection_id IS NULL;

CREATE TABLE ai_generations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id     INTEGER REFERENCES collections(id),
  prompt            TEXT NOT NULL,
  model             TEXT NOT NULL,
  provider          TEXT NOT NULL,          -- ollama | openai | anthropic | custom
  generated_yaml    TEXT,                   -- результат генерации (YAML)
  output_path       TEXT,                   -- путь к сохранённому файлу
  status            TEXT NOT NULL,          -- success | error
  error_message     TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  duration_ms       INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Индексы для дашборда
CREATE INDEX idx_runs_started ON runs(started_at DESC);
CREATE INDEX idx_runs_collection ON runs(collection_id);
CREATE INDEX idx_results_run ON results(run_id);
CREATE INDEX idx_results_status ON results(status);
CREATE INDEX idx_results_name ON results(suite_name, test_name);
CREATE INDEX idx_collections_name ON collections(name);
```

Миграции: массив SQL-строк с номером версии. При старте проверяется `PRAGMA user_version`, применяются недостающие миграции. Текущая версия: **5**.

Версии: V1 — базовые таблицы, V2 — `ai_generations`, V3 — `chat_sessions`/`chat_messages`, V4 — `settings`, V5 — `base_dir` в collections + `collection_id` в environments (scoped envs).

---

### M6: WebUI (`src/web/`)

Запускается командой `apitool serve --port 8080`.

Hono-сервер рендерит HTML, интерактивность через HTMX.

**Страницы:**

| Route | Описание |
|-------|----------|
| `GET /` | Dashboard: глобальные метрики, grid коллекций, форма добавления, recent runs, slowest/flaky |
| `GET /collections/:id` | Детали коллекции: метрики, trend chart, test suites (кликабельные — YAML, source, AI prompt/model), broken-файлы с Delete, per-suite Run, таблица прогонов |
| `GET /runs` | Список прогонов с фильтрацией (статус, environment, дата, поиск по имени теста) и пагинацией |
| `GET /runs/:id` | Детали прогона: каждый тест → запрос/ответ/ассерты + кнопки Export (JUnit XML, JSON) |
| `GET /environments` | Список окружений: имя, scope (global/api:N), кол-во переменных, actions (Edit/Delete), форма создания |
| `GET /environments/:id` | Редактор окружения: key-value editor с добавлением/удалением строк |
| `POST /environments` | Создать окружение (HTMX form-data) |
| `PUT /environments/:id` | Обновить переменные окружения (HTMX form-data) |
| `DELETE /environments/:id` | Удалить окружение (HTMX) |
| `GET /collections/:id/suites` | Список YAML test files: имя suite, кол-во тестов, base URL, Run/View/Delete |
| `GET /collections/:id/suites/detail?file=` | Детали suite: карточки метрик, таблица шагов с method badge, Run Suite |
| `GET /explorer` | Дерево API из OpenAPI, параметры, описания, multi-auth panel |
| `POST /collections` | Создать коллекцию из формы на дашборде (HTMX form-data) |
| `DELETE /collections/:id` | Удалить коллекцию (HTMX, runs unlinked) |
| `POST /run` | Запустить прогон из WebUI (HTMX form-data), авто-привязка к коллекции |
| `POST /api/try` | Отправить единичный запрос из Explorer (HTMX, с auth injection) |
| `POST /api/authorize` | Proxy login для Bearer auth (username/password → token) |
| `GET /api/export/:runId/junit` | Скачать JUnit XML отчёт для прогона |
| `GET /api/export/:runId/json` | Скачать JSON отчёт для прогона |
| `POST /api/ai-generate` | Генерация тестов через AI (Ollama/OpenAI/Anthropic) |
| `POST /api/ai-generate/save` | Сохранить YAML в файл, записать `output_path` в БД, показать подтверждение |
| `POST /api/ai-generate/delete-file` | Удалить broken/ненужный файл из коллекции (с проверкой что файл внутри test_path) |
| `GET /api/ai-generation/:id` | Просмотр деталей генерации (YAML, метаданные, путь файла) — HTMX fragment |

Dashboard-метрики (SQL-запросы):

- **Pass rate trend:** последние 30 прогонов, `passed / total * 100` — SVG line chart с area fill
- **Flaky-тесты:** тесты с разным статусом в последних N прогонах
- **Средняя длительность:** `AVG(duration_ms)` по тестам
- **Самые медленные:** `ORDER BY duration_ms DESC LIMIT 5`

Фильтрация прогонов (`GET /runs`):
- **Status:** All / Has Failures / All Passed
- **Environment:** dropdown из `listEnvironments()` + `getDistinctEnvironments()` (объединение определённых и из истории прогонов)
- **Date range:** from / to
- **Test name:** поиск по имени теста (LIKE)

Экспорт результатов (`/runs/:id`):
- **JUnit XML** — `GET /api/export/:runId/junit` (Content-Disposition: attachment)
- **JSON** — `GET /api/export/:runId/json` (Content-Disposition: attachment)

Статика: HTMX (CDN или вкомпилирован), CSS (один файл, без фреймворков).

---

### M7: CLI (`src/cli/`)

| Команда | Описание | Основные флаги |
|---------|----------|----------------|
| `add-api <name>` | Регистрация нового API (создаёт коллекцию, директории, .env.yaml) | `--spec <path-or-url>`, `--dir <directory>`, `--env key=value` |
| `run <path>` | Запуск тестов (авто-привязка к коллекции) | `--api <name>`, `--env`, `--report json\|junit\|console`, `--timeout`, `--bail`, `--no-db`, `--db`, `--auth-token`, `--safe` |
| `ai-generate` | AI-генерация тестов из OpenAPI | `--api <name>`, `--from <spec>`, `--prompt`, `--provider`, `--model`, `--api-key`, `--base-url`, `--output` |
| `request <METHOD> <URL>` | Ad-hoc HTTP запрос с цветным выводом | `--header "K:V"` (multiple), `--body '{}'`, `--env`, `--timeout` |
| `envs [list\|get\|set\|delete]` | Управление окружениями (CRUD) | `--api <name>`, `envs get <name>`, `envs set <name> K=V ...`, `envs delete <name>` |
| `runs [id]` | История прогонов и детали | `--limit <n>`, `--db <path>` |
| `coverage` | Анализ покрытия API тестами | `--api <name>`, `--spec <path>`, `--tests <dir>` |
| `collections` | Список коллекций с pass rate и датой последнего прогона | `--db <path>` |
| `serve` | Запуск WebUI | `--port`, `--host`, `--openapi <spec>`, `--db <path>`, `--watch` |
| `validate` | Проверка YAML-тестов | `<path>` |
| `chat` | Интерактивный AI-агент для управления тестами | `--provider`, `--model`, `--api-key`, `--base-url`, `--safe` |
| `mcp` | MCP-сервер для AI-агентов | `--db` |
| `doctor` | Диагностика (DB, тесты, OpenAPI, Ollama) | `--db <path>` |
| `init` | Scaffolding нового проекта | `--force` |
| `update` | Обновление до последней версии | `--force` |

Флаг `--api <name>` — альтернатива пути, автоматически резолвит `test_path`, `openapi_spec` и `base_dir` из коллекции в DB. Пример: `apitool run --api petstore` вместо `apitool run ./apis/petstore/tests/`.

Exit codes: `0` — все тесты прошли, `1` — есть падения, `2` — ошибка конфигурации.

---

### M10: AI Generation (`src/core/generator/ai/`)

AI-генерация тестов из OpenAPI-спецификации с использованием LLM.

**Архитектура:**

```
OpenAPI spec + prompt
        │
        ▼
  prompt-builder.ts    → системный промпт + контекст API + пользовательский запрос
        │
        ▼
  llm-client.ts        → HTTP-запрос к LLM-провайдеру
        │
        ▼
  output-parser.ts     → JSON-ответ LLM → TestSuite[] → serializeSuite() → YAML
```

**Ключевое решение:** LLM генерирует **JSON** (не YAML), затем `serializeSuite()` конвертирует в YAML. Это обеспечивает валидный формат вне зависимости от качества ответа модели.

**Провайдеры:**

| Провайдер | Base URL | Модель по умолчанию |
|-----------|----------|-------------------|
| `ollama` | `http://localhost:11434/v1` | `qwen3:4b` |
| `openai` | `https://api.openai.com/v1` | `gpt-4o` |
| `anthropic` | `https://api.anthropic.com` | `claude-sonnet-4-20250514` |
| `custom` | задаётся через `--base-url` | задаётся через `--model` |

**CLI:** `apitool ai-generate --from <spec> --prompt "..." --provider <name> --model <name> --api-key <key> --output <dir>`

**WebUI:**
- Форма генерации: выбор провайдера, модель, промпт
- Preview сгенерированного YAML перед сохранением
- Сохранение в файл с привязкой к коллекции
- История генераций с View/Reuse
- AI badge на suite'ах, сгенерированных через AI

**БД:** таблица `ai_generations` — хранит prompt, model, provider, результат, token usage, duration.

---

### Agent — AI Chat

Интерактивный AI-агент в терминале. Использует AI SDK v6 (`generateText` + `tool()` + `stopWhen`).

**Запуск:** `apitool chat` (Ollama/qwen3:4b по умолчанию), `apitool chat --provider openai --api-key sk-...`

**7 tools:** `run_tests`, `validate_tests`, `query_results`, `manage_environment`, `diagnose_failure`, `send_request`, `explore_api` — каждый как AI SDK `tool()` с Zod `inputSchema`.

**Особенности:**
- Safe mode (`--safe`) — принудительно только GET-тесты
- Context manager — автосжатие диалога при >20 сообщений
- Для Ollama system prompt инжектируется в user message (workaround для thinking-моделей)

Подробная документация: [docs/agent.md](docs/agent.md)

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
| M3 (Generator) | DONE | `e3d94d8` | OpenAPI reader, data factory, serializer (шаблонная генерация удалена → только AI) |
| M4 (Reporter) + M7 (CLI basic) | DONE | `e179180` | console/json/junit отчёты, CLI команды |
| M5 (Storage/SQLite) | DONE | `2245e79` | История прогонов в apitool.db |
| M6 (WebUI) | DONE | `94a58e4` | `apitool serve --port 8080 --openapi <spec>`, multi-auth panel, trend chart, filters, export |
| M7 (CLI) | DONE | — | run, generate, ai-generate, collections, serve, validate |
| M8 (Standalone binary) | DONE | `6bd2401` | `bun run build` → `apitool.exe`, CSS embedded, runtime detection |
| M9 (Collections) | DONE | `56a3995` | Сущность Collection, группировка runs, CLI `collections`, dashboard redesign |
| M10 (AI Generate) | DONE | `7901df7` | AI-генерация тестов, история генераций с View/Reuse, AI badge на сьютах, сохранение с output_path |
| M11 (Suite Details) | DONE | `9e4e87e` | Кликабельные сьюты (YAML, source file, AI prompt/model), показ broken-файлов с Delete, per-suite Run, улучшенный AI-промпт |
| M12 (Public Release) | DONE | `da9e027` | README, CHANGELOG, CI pipeline, GitHub Release workflow |
| M13 (Environments) | DONE | — | CRUD окружений в WebUI, key-value editor, env selector при запуске тестов |
| M14 (Self-Documented API) | DONE | — | OpenAPI спека из собственного API, инкрементальная генерация, dogfooding |
| M15 (MCP Server) | DONE | — | 11 MCP tools для AI-агентов, stdio transport |
| M16 (Generate Wizard) | DONE | — | Safe mode, auth-token, env creation, relative base_url |
| M19 (Unified Capabilities) | DONE | — | request, envs, runs, coverage CLI + 5 MCP tools + 2 agent tools |
| M20 (Post-M19) | DONE | — | doctor, envs import/export, DB singleton fix |
| M21 (Collection Architecture) | DONE | — | add-api, --api flag, environment scoping, base_dir, DB V5 |

---

## Сборка и установка

```bash
# Разработка (требуется Bun runtime)
bun run src/cli/index.ts run tests/

# Компиляция в standalone бинарник
bun run build
# или: bun build --compile src/cli/index.ts --outfile apitool

# Результат: apitool / apitool.exe — один файл, Bun не нужен
./apitool run tests/*.yaml
./apitool serve --port 8080
```

### Установка

Скопировать бинарник в любую папку из `PATH`:

```bash
# Linux / macOS
cp apitool /usr/local/bin/

# Windows — скопировать apitool.exe в папку из PATH
```

После этого `apitool` доступен из любой директории.

### Как работает бинарник

Бинарник **stateless** — он ничего не хранит внутри себя. Все файлы создаются в **текущей рабочей директории** (cwd):

```bash
cd ~/projects/myapi

# Регистрация API — создаст ./apis/myapi/, .env.yaml, запись в DB
apitool add-api myapi --spec openapi.json

# AI-генерация тестов
apitool ai-generate --api myapi --prompt "test all user endpoints"

# Запуск тестов — создаст ./apitool.db для хранения результатов
apitool run --api myapi

# Web-дашборд — читает apitool.db и спеку из cwd
apitool serve --port 4000 --openapi openapi.json
```

| Артефакт | Расположение | Описание |
|----------|-------------|----------|
| YAML-тесты | `./generated/` (или `--output <dir>`) | Сгенерированные/написанные тесты |
| `apitool.db` | `./apitool.db` (или `--db <path>`) | SQLite — история прогонов |
| OpenAPI спека | указывается через `--from` / `--openapi` | Читается, не копируется |

### Runtime detection

```bash
./apitool --version
# apitool 0.1.0 (standalone)   — из скомпилированного бинарника

bun src/cli/index.ts --version
# apitool 0.1.0 (bun)          — из dev-режима
```

---

## M15: MCP Server (AI-agent интеграция)

APITOOL предоставляет MCP (Model Context Protocol) сервер для интеграции с AI-агентами (Claude Code, Cursor, Windsurf, Cline).

### Запуск

```bash
apitool mcp              # stdio transport
apitool mcp --db ./my.db # с кастомным путём к БД
```

### MCP Tools

| Tool | Описание |
|------|----------|
| `run_tests` | Запуск тестов из YAML-файла/директории, возврат summary |
| `validate_tests` | Валидация YAML без запуска |
| `list_collections` | Список коллекций с статистикой |
| `list_runs` | Список последних прогонов |
| `get_run_results` | Детальные результаты конкретного прогона |
| `list_environments` | Список окружений (ключи переменных, без значений) |
| `send_request` | Ad-hoc HTTP запрос с variable interpolation из окружений |
| `explore_api` | Просмотр OpenAPI спеки — endpoints, servers, security schemes, фильтр по tag |
| `manage_environment` | CRUD окружений — list, get, set, delete (с `collectionName` для scoping) |
| `diagnose_failure` | Диагностика падений — анализ failed steps и assertion mismatches |
| `coverage_analysis` | Анализ покрытия API тестами (spec vs test files) |

### Конфигурация Claude Code

```json
// .claude/settings.json или claude_desktop_config.json
{
  "mcpServers": {
    "apitool": {
      "command": "apitool",
      "args": ["mcp"]
    }
  }
}
```

---

## Принципы

1. **Один файл** — скачал бинарник, запустил, работает. Без Docker, без apt install.
2. **Тесты как код** — YAML в git, code review, merge requests.
3. **OpenAPI-first** — спецификация есть → тесты генерируются.
4. **Два режима** — CLI для CI/CD, WebUI для команды. Одна кодовая база.
5. **SQLite по умолчанию** — история работает из коробки, без настройки БД.

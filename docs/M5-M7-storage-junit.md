# M5: Storage (SQLite) + JUnit Reporter

Автоматическое сохранение истории прогонов в SQLite и JUnit XML для CI-систем.

## Быстрый старт

```bash
# Запуск с сохранением в БД (по умолчанию)
bun src/cli/index.ts run examples/

# JUnit XML для CI
bun src/cli/index.ts run tests/ --report junit > results.xml

# Без сохранения в БД
bun src/cli/index.ts run tests/ --no-db

# Своя БД
bun src/cli/index.ts run tests/ --db /path/to/my.db
```

---

## JUnit Reporter

### Использование

```bash
bun src/cli/index.ts run tests/ --report junit
bun src/cli/index.ts run tests/ --report junit > results.xml
```

### Формат вывода

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="5" failures="1" errors="0" time="2.340">
  <testsuite name="Users CRUD" tests="5" failures="1" errors="0" skipped="0" time="2.340">
    <testcase name="Create user" time="0.450"/>
    <testcase name="Get user" time="0.120"/>
    <testcase name="Update user" time="0.310">
      <failure message="equals 200: expected 200, got 500">equals 200: expected 200, got 500</failure>
    </testcase>
    <testcase name="Verify deleted" time="0.000">
      <skipped/>
    </testcase>
    <testcase name="Broken endpoint" time="0.050">
      <error message="Connection refused">Connection refused</error>
    </testcase>
  </testsuite>
</testsuites>
```

### Маппинг статусов

| Статус шага | XML-элемент |
|-------------|-------------|
| `pass` | `<testcase .../>`  (без дочерних элементов) |
| `skip` | `<testcase ...><skipped/></testcase>` |
| `fail` | `<testcase ...><failure message="...">...</failure></testcase>` |
| `error` | `<testcase ...><error message="...">...</error></testcase>` |

**Атрибут `time`** — в секундах с тремя знаками после запятой: `(ms / 1000).toFixed(3)`.

**XML-экранирование** применяется ко всем строковым значениям: `& < > " '`.

### Программное использование

```typescript
import { junitReporter } from "./src/core/reporter/junit.ts";
import type { TestRunResult } from "./src/core/runner/types.ts";

const results: TestRunResult[] = /* ... */;
junitReporter.report(results);  // пишет XML в stdout
```

---

## Storage (SQLite)

### Поведение по умолчанию

При каждом `apitool run` создаётся или обновляется файл `apitool.db` в текущей директории. Файл создаётся автоматически при первом запуске.

```bash
apitool run tests/            # сохраняет в ./apitool.db
apitool run tests/ --no-db    # пропустить сохранение
apitool run tests/ --db ci.db # сохранить в ci.db
```

Флаг `--db` принимает абсолютный или относительный путь.

### Схема БД

```sql
CREATE TABLE runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL,    -- ISO 8601
  finished_at TEXT,
  total       INTEGER NOT NULL DEFAULT 0,
  passed      INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  trigger     TEXT DEFAULT 'manual',
  commit_sha  TEXT,
  branch      TEXT,
  environment TEXT,
  duration_ms INTEGER
);

CREATE TABLE results (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          INTEGER NOT NULL REFERENCES runs(id),
  suite_name      TEXT NOT NULL,
  test_name       TEXT NOT NULL,
  status          TEXT NOT NULL,  -- pass | fail | skip | error
  duration_ms     INTEGER NOT NULL,
  request_method  TEXT,
  request_url     TEXT,
  request_body    TEXT,
  response_status INTEGER,
  response_body   TEXT,           -- хранится только при fail/error
  error_message   TEXT,
  assertions      TEXT            -- JSON: AssertionResult[]
);

CREATE TABLE environments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,
  variables TEXT NOT NULL         -- JSON: Record<string, string>
);
```

**Примечание:** `response_body` сохраняется только для шагов со статусом `fail` или `error`, чтобы экономить место.

### Миграции

Версия схемы хранится в `PRAGMA user_version`. При каждом открытии БД применяются только недостающие миграции в транзакции.

### Настройки производительности

При открытии БД автоматически устанавливаются:
- `PRAGMA journal_mode = WAL` — concurrent reads без блокировки
- `PRAGMA foreign_keys = ON` — проверка ссылочной целостности

### Программное использование

```typescript
import { getDb, closeDb } from "./src/db/schema.ts";
import {
  createRun, finalizeRun, saveResults,
  getRunById, listRuns, deleteRun,
  upsertEnvironment, getEnvironment, listEnvironments,
} from "./src/db/queries.ts";

// Открыть БД (синглтон)
const db = getDb();           // apitool.db в cwd
const db2 = getDb("my.db");   // конкретный файл

// Сохранить прогон
const runId = createRun({ started_at: new Date().toISOString(), environment: "staging" });
// ... выполнить тесты ...
finalizeRun(runId, results);
saveResults(runId, results);

// Чтение истории
const runs = listRuns(10, 0);        // последние 10 прогонов
const run = getRunById(1);
const steps = getResultsByRunId(1);  // шаги с десериализованными assertions

// Управление окружениями
upsertEnvironment("staging", { BASE_URL: "https://staging.example.com" });
const vars = getEnvironment("staging");
const names = listEnvironments();

// В тестах — закрыть синглтон
closeDb();
```

### API queries.ts

| Функция | Описание |
|---------|----------|
| `createRun(opts)` → `number` | Создать запись run, вернуть id |
| `finalizeRun(runId, results[])` | Обновить totals и finished_at |
| `saveResults(runId, results[])` | Bulk-insert шагов в транзакции |
| `getRunById(id)` → `RunRecord \| null` | Запись run по id |
| `getResultsByRunId(id)` → `StoredStepResult[]` | Шаги run с assertions из JSON |
| `listRuns(limit?, offset?)` → `RunSummary[]` | Список прогонов по дате DESC |
| `deleteRun(id)` → `boolean` | Удалить run и его результаты |
| `upsertEnvironment(name, vars)` | Создать или обновить окружение |
| `getEnvironment(name)` → `Record<string, string> \| null` | Переменные окружения |
| `listEnvironments()` → `string[]` | Имена всех окружений |

---

## Новые флаги CLI

### `run` — обновлённая сигнатура

```
apitool run <path> [options]

  --report <format>    console | json | junit  (default: console)
  --no-db              Не создавать/обновлять apitool.db
  --db <path>          Путь к файлу БД  (default: apitool.db в cwd)
  --env <name>         Файл окружения .env.<name>.yaml
  --timeout <ms>       Таймаут запроса
  --bail               Остановиться после первого упавшего suite
  --auth-token <token> Auth-токен, доступен как {{auth_token}} переменная
```

### Примеры

```bash
# Стандартный прогон: вывод в консоль + сохранение в apitool.db
apitool run tests/

# CI: JUnit XML + своя БД
apitool run tests/ --report junit --db ci/history.db > junit.xml

# Dry-run без БД
apitool run tests/ --no-db

# Staging-окружение
apitool run tests/ --env staging --db runs/staging.db

# Только JUnit, без записи в БД
apitool run tests/ --report junit --no-db > results.xml

# CI с внешним токеном
apitool run tests/ --auth-token "$CI_AUTH_TOKEN" --report junit > results.xml
```

---

## Архитектура

### Pipeline команды `run` (обновлённый)

```
parse(path)
  → loadEnvironment(env, dir)
  → [if --auth-token] env.auth_token = token
  → --timeout override
  → runSuites() / runSuites() + bail
  → reporter.report(results)           # console | json | junit
  → [if !--no-db] getDb(dbPath)
                  createRun(opts)
                  finalizeRun(runId, results)
                  saveResults(runId, results)
  → exit code (0 | 1 | 2)
```

Сохранение в БД — **non-fatal**: при ошибке выводится предупреждение, exit code не меняется.

### Файловая структура

```
src/
├── db/
│   ├── schema.ts    # getDb(), closeDb(), миграции
│   └── queries.ts   # CRUD: runs, results, environments
└── core/reporter/
    ├── junit.ts     # JUnit XML reporter
    ├── types.ts     # ReporterName: "console"|"json"|"junit"
    └── index.ts     # getReporter() factory
```

### Reporter factory

```typescript
import { getReporter } from "./src/core/reporter/index.ts";

const reporter = getReporter("junit");   // "console" | "json" | "junit"
reporter.report(results);
```

---

## Тесты

```bash
bun test tests/reporter/junit.test.ts  # JUnit reporter (22 tests)
bun test tests/db/schema.test.ts       # SQLite schema (10 tests)
bun test tests/db/queries.test.ts      # DB queries (20 tests)
bun test tests/cli/commands.test.ts    # CLI commands (16 tests)

bun test tests/                        # все unit-тесты
```

### Покрытие

| Файл | Тесты |
|------|-------|
| `reporter/junit.ts` | XML-структура, time-форматирование, XML-экранирование, все 4 статуса |
| `db/schema.ts` | Создание файла, синглтон, таблицы, индексы, WAL, FK, версия, идемпотентность |
| `db/queries.ts` | createRun, finalizeRun, saveResults, getResultsBy RunId, listRuns, deleteRun, environments |
| `cli/commands/run.ts` | `--no-db` пропускает БД, `--db` использует указанный путь, junit reporter в pipeline, `--auth-token` парсинг и инъекция |

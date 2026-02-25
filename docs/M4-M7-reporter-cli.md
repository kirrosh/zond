# M4: Reporter + M7: CLI (базовый)

Модули вывода результатов и командной строки.

## Быстрый старт

```bash
# Запуск тестов
bun src/cli/index.ts run examples/jsonplaceholder.yaml

# Валидация YAML без запуска
bun src/cli/index.ts validate examples/jsonplaceholder.yaml

# JSON-вывод
bun src/cli/index.ts run tests/ --report json

# Помощь
bun src/cli/index.ts --help
```

## CLI-команды

### `run <path>`

Запуск API-тестов. Принимает файл `.yaml` или директорию.

```bash
bun src/cli/index.ts run tests/api.yaml
bun src/cli/index.ts run tests/              # все YAML в директории
bun src/cli/index.ts run tests/ --env staging --report json --timeout 5000 --bail
```

| Флаг | Описание | По умолчанию |
|------|----------|-------------|
| `--env <name>` | Файл окружения `.env.<name>.yaml` | `.env.yaml` |
| `--report <format>` | Формат вывода: `console`, `json` | `console` |
| `--timeout <ms>` | Таймаут запроса (мс) | `30000` |
| `--bail` | Остановиться после первого упавшего suite | `false` |

Exit codes:
- `0` — все тесты прошли
- `1` — есть упавшие тесты
- `2` — ошибка конфигурации (невалидный YAML, неверные аргументы)

### `validate <path>`

Проверка YAML-тестов без HTTP-запросов.

```bash
bun src/cli/index.ts validate tests/api.yaml
# OK: 1 suite(s), 4 test(s) validated successfully

bun src/cli/index.ts validate tests/broken.yaml
# Error: Validation error in tests/broken.yaml: ...
```

Exit codes: `0` — валидно, `2` — ошибка.

## Reporter

### Console Reporter

Цветной вывод в терминал (ANSI). Цвета отключаются автоматически при перенаправлении в файл.

```
 Users CRUD
  ✓ Create user (450ms)
  ✓ Get user (120ms)
  ✗ Update user (310ms)
    status: expected equals 200 but got 500
  ○ Verify deleted (skipped)

Results: 2 passed, 1 failed, 1 skipped (1.2s)
```

Для нескольких suites выводится итого:

```
Total: 5 passed, 1 failed (2.3s)
```

### JSON Reporter

Сериализация `TestRunResult[]` в stdout. Для записи в файл:

```bash
bun src/cli/index.ts run tests/ --report json > results.json
```

## Программное использование

```typescript
import { getReporter } from "./src/core/reporter/index.ts";
import { parseFile } from "./src/core/parser/index.ts";
import { runSuite } from "./src/core/runner/index.ts";

const suite = await parseFile("tests/api.yaml");
const result = await runSuite(suite);

// Console-вывод
const reporter = getReporter("console");
reporter.report([result]);

// JSON-вывод
const jsonReporter = getReporter("json");
jsonReporter.report([result]);
```

### Форматирующие функции (экспортируются для кастомизации)

```typescript
import {
  formatDuration,     // (ms: number) => "450ms" | "1.2s" | "2m 5s"
  formatStep,         // (step: StepResult, color: boolean) => string
  formatFailures,     // (step: StepResult, color: boolean) => string
  formatSuiteResult,  // (result: TestRunResult, color: boolean) => string
  formatGrandTotal,   // (results: TestRunResult[], color: boolean) => string
} from "./src/core/reporter/index.ts";
```

## Архитектура

### Reporter (src/core/reporter/)

```
TestRunResult[] → getReporter("console" | "json") → report(results) → stdout
```

- `types.ts` — интерфейсы Reporter, ReporterOptions, ReporterName
- `console.ts` — ANSI-форматирование, `✓`/`✗`/`○`, duration, assertion details
- `json.ts` — `JSON.stringify(results, null, 2)`
- `index.ts` — barrel export + `getReporter()` factory

### CLI (src/cli/)

```
process.argv → parseArgs() → command routing → run/validate → process.exitCode
```

- `index.ts` — entry point, парсинг argv, роутинг команд
- `output.ts` — ANSI-утилиты: `printError`, `printSuccess`, `printWarning`
- `commands/run.ts` — pipeline: `parse() → loadEnvironment() → runSuites() → report()`
- `commands/validate.ts` — `parse()` → OK / error

### Pipeline команды `run`

1. `parse(path)` — файл или директория → `TestSuite[]`
2. `loadEnvironment(env, dir)` — загрузка `.env.yaml`
3. `--timeout` override → мутация `suite.config.timeout`
4. `runSuites()` или sequential с `--bail`
5. `reporter.report(results)`
6. Exit code по результатам

### Bail mode

При `--bail` suites запускаются последовательно. Если suite содержит `failed > 0` или `error`, последующие suites пропускаются.

## Зависимости

Новых зависимостей нет. Используются:
- Bun built-in: `process.argv`, `process.exitCode`, `console.log`
- Node compat: `path.dirname`
- Существующие модули: Parser, Runner

## Тесты

```bash
bun test tests/reporter/    # reporter (25 tests)
bun test tests/cli/         # CLI (18 tests)
bun test                    # все тесты (137 unit + 2 integration)
```

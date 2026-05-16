# Test suite audit (2026-05-07)

Аудит всех 98 тест-файлов (~1076 тестов). Зелёные, ~12с прогон. Делался группами через 5 параллельных reviewer-агентов.

## Сводка

| Группа                       | Файлов | keep | refactor | delete/merge |
|------------------------------|-------:|-----:|---------:|-------------:|
| CLI (`tests/cli`)            |     30 |   25 |        4 |            1 |
| Runner (`tests/runner`)      |     10 |    9 |        0 |            1 (merge) |
| Generator/Parser             |     20 |   20 |        0 |            0 |
| Core/DB/Diagnostics          |     30 |   29 |        1 |            0 |
| Reporter/Integration/UI      |      9 |    7 |        1 |            1 (split) |

Итог по тестам после правок: **1076 → 1072**, **98 → 96 файлов** (всё зелёное).

## Применённые правки

- **Удалён** `tests/integration/auth-flow.test.ts` — 159 строк inline-сервера ради единственного assert'а `spec.openapi === "3.0.0"`. Импорты `parseFile`/`runSuite`/`extractSecuritySchemes` не использовались. Когда понадобится настоящий end-to-end auth — пишем заново.
- **Удалён** describe `"UI SPA smoke (dev bundle)"` в `tests/ui/routes.test.ts` (3 теста: `/`, `/runs`, `/runs/1` → `<!doctype html>`). Это противоречит правилу "curl на SPA-роуты бесполезен — нужен Playwright" (memory) и ничего не проверяет кроме history-fallback. Место — будущий e2e-набор Playwright.
- **Слит** `tests/core/runner/root-body-assertions.test.ts` → `tests/runner/assertions.test.ts` как describe-блок `_body root path`. Файл удалён, директория `tests/core/runner/` тоже.
- **Переименованы** конфликтующие describe `classifyFailure` в diagnostics: теперь
  `classifyFailure (FailureClassDescriptor, from failure-class)` и
  `classifyFailure (string label, from failure-hints)`.

## Открытые рекомендации (требуют отдельной задачи)

Все низкого приоритета — заводить TASK по необходимости:

### CLI
- **`tests/cli/cli-smoke.test.ts`** — 4 spawn'а реального процесса; `ui` alias дублирует `program.test.ts`. Сжать до 1-2 канареек.
- **`tests/cli/completions.test.ts`** — 5 spawn'ов дублируют unit. Достаточно одного smoke + unit.
- **`tests/cli/doctor.test.ts`** — 8 spawn'ов; большинство кейсов могут вызывать `doctorCommand` напрямую.
- **`tests/cli/internal-error.test.ts`** — slить с `program.test.ts` как describe `usage errors do not have [zond:internal] prefix`.
- **`tests/cli/serve.test.ts`** — тест #1 не возвращает stop-handle и течёт. Нужно расширить `serveCommand` чтобы возвращать stopper. + `pickFreePort()` рандомен → потенциально flaky.
- **`tests/cli/commands.test.ts`** — тест `--timeout overrides suite config` фактически не проверяет, что timeout срабатывает (mock возвращает success → exit 0). Либо доработать (slow fetch + actual timeout fail), либо убрать.
- **`tests/cli/catalog.test.ts`** — тест `defaults output to current directory` передаёт явный output, описание не соответствует поведению.
- **`tests/cli/update.test.ts`** — нет happy-path (compiled binary, успешное обновление). OK как есть; добавить unit на comparison helpers если будет регрессия.

### Runner
- **`tests/runner/executor.test.ts`** — двойной `afterEach(originalFetch)` (внешний и внутри describe `setup suite propagation`); тест `sends multipart/form-data with text fields` лежит не в той категории. `mockFetchResponses` 500-fallback маскирует утечку лишних вызовов — лучше throw.
- **`tests/runner/preflight-vars.test.ts`** — слабое покрытие. Не тестируются ветви `each`/`contains_item`/`retry_until.condition`/`for_each.in`/`multipart`/`form`/`base_url` → preflight-регрессии могут проходить незаметно.
- **`tests/runner/transforms.test.ts`** — не покрыты edge cases (`get` OOB, `length` для number, `append` с одним arg).
- **`tests/runner/expr-eval.test.ts`** — не покрыто лексикографическое сравнение строк через `<`/`>`.
- **`tests/runner/parameterize.test.ts`** — тест `schema accepts parameterize map` относится к parser, не runner; перенести.
- **Дубль** «rate limiter throttling» — есть и в `http-client.test.ts`, и в `rate-limiter.test.ts`. Оставить как smoke в http-client, основной — в rate-limiter.

### Пробелы покрытия раннера (нет своих тестов)
- `src/core/runner/send-request.ts` (136 строк): кодирование `json`/`form`/`multipart`, `file:@path`, streaming тела — покрывается только косвенно через executor (1 multipart-кейс).
- `src/core/runner/auth-path.ts` — нет тестов вообще.
- `networkBackoffMs` — экспортируется, не тестируется.
- `executor`: timeout-аборт на уровне runSuite, `for_each` с captured-list, `for_each × parameterize`, `set:` с transform + `{{$generator}}`, `retry_until` с `body`-условием и `delay_ms > 0`.
- `schema-validator`: composition (`oneOf`/`anyOf`/`allOf`), `additionalProperties:false`, `pattern`, request-body validation.

### Core/Probes
- **`tests/core/probe/security-probe.test.ts`** (872 строки) — раздутая mock-фабрика дублируется 8+ раз. **Split на 3 файла**: `security-probe-classify.test.ts` (detectFields + severity), `security-probe-restore.test.ts` (TASK-151/152), `security-probe-cleanup.test.ts` (round-4/5 retries) + общий `tests/core/probe/_helpers/` с фабриками `ep()` / `installFetchMock()` / `responder builder`.
- **`tests/core/probe/mass-assignment-probe.test.ts`** — тест `auth header injected from vars` не проверяет headers (комментарий честно признаёт). Заменить fetch-mock на тот, что в `path-discovery.test.ts` (захватывает `init.headers`), либо удалить тест.
- **Общая фабрика `ep()`** копипастится в 6+ файлах probe/. Вынести в `tests/core/probe/_helpers/endpoint.ts`.
- **`withTempWorkspace(fn)` helper** — `tmp-workspace + chdir` паттерн повторяется в session/setup-api-helpers/manifest/root.

### Diagnostics
- **`tests/diagnostics/env-issue-override.test.ts`** — хелперы `failingStep`/`passStep` определены только во втором describe; первый раздут inline-объектами. Унифицировать.

### Reporter
- **`tests/reporter/console-5xx.test.ts`** дублирует setup-хелперы (`makeStep`/`makeResult`) с `console.test.ts` — копипаста ~30 строк. Слить в один файл с extracted-хелпером, либо вынести в `tests/reporter/_helpers/`.

### Generator/Parser (low-prio)
- `tests/generator/openapi-reader.test.ts` `expect(endpoints.length).toBe(7)` — хрупкая привязка к фикстуре. Лучше assert по содержимому.
- `tests/parser/yaml-parser.test.ts` `parses valid yaml files in a clean directory` пишет в `tests/fixtures/valid/`, а не в `tmpdir` — потенциальный артефакт в git.
- `tests/parser/variables.test.ts` имеет 3 теста на `loadEnvironment`, частично пересекающиеся с `tests/parser/load-environment.test.ts`. Можно сконсолидировать в одном файле.
- `tests/generator/suite-generator.test.ts` (937 строк) — кандидат на split по `describe` (crud-groups / auth-suite / smoke-seeds), но не блокер.

## Принципы (стандарт для новых тестов)

### Что писать

1. **Прямой импорт command-функции** + tmp DB/dir + mock `globalThis.fetch`. Образцы: `commands.test.ts`, `request.test.ts`, `init.test.ts`. Spawn реального `bun src/cli/index.ts` оправдан только для exit-code контракта (1-2 канарейки в `cli-smoke.test.ts`).
2. **Чистый unit на helper**, когда есть чистая функция (`status-filter`, `lint-spec`, `json-envelope`, `agents-md`).
3. **Поведенческие ассерты, не "не упало"**: `fetchMock.mock.calls.length`, `capturedHeaders`, `inFlight/maxInFlight`, содержимое выходного файла, shape envelope.
4. **Negative path = правило**. Schema/parser-тесты обязаны иметь `expect(...).toThrow(...)` для каждой ошибочной ветки.
5. **Round-trip как контракт-тест**: `serializeSuite → YAML.parse → validateSuite`, JUnit XML re-parse, JSON report re-parse.
6. **TASK-маркер в названии** (`TASK-72: ...`). Связка тест↔backlog бесплатна.
7. **Один тест — одна ветка классификатора** (`coverage-reasons`, `failure-class`).
8. **Большие файлы (>500 строк) — split по describe-доменам** (паттерн `negative-probe` ↔ `negative-probe-cleanup`).
9. **Фабрики/фикстуры > inline-setup**, если копипастится в 3+ файлах — выносить в `tests/<domain>/_helpers/`.

### Чего избегать

1. **Spawn CLI массово** — Bun-старт ~200ms × N. Spawn только для границы процесса.
2. **"Тесты, которые не упали"** — exit=0, mock вернул ok, без проверки целевого поведения.
3. **`toContain("Total")` без anchor** — ломается от косметики. Лучше structural.
4. **Snapshot-подобные `toBe(7)` на длине endpoint-списка из фикстуры** — хрупко.
5. **Leak-и ресурсов**: server, db handle, cwd — обязательный `afterEach` teardown.
6. **Timing-asserts вне модулей-таймеров**. Для executor проверяй `callCount`/`urls.length`, не `elapsed`.
7. **Дублирующие проверки одного контракта** в разных файлах (`ui alias removed` × 3 файла).
8. **Mock внутренних модулей** — граница это `globalThis.fetch`/FS/DB.
9. **Артефакты в `tests/fixtures/`** — использовать `mkdtempSync(tmpdir())`.
10. **SPA через `fetch().text() + match <!doctype html>`** — это место Playwright e2e.

### Шаблон mock-fetch

```ts
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function mockFetchResponses(responses: Array<{ status: number; body: unknown }>) {
  let i = 0;
  globalThis.fetch = mock(async () => {
    const r = responses[i++];
    if (!r) throw new Error("unexpected fetch call"); // throw, не 500-fallback
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}
```

`throw` на лишнем вызове ловит регрессии. 500-fallback маскирует утечку.

### Layering

| Слой                                | Где                  | Mock-граница               |
|-------------------------------------|----------------------|----------------------------|
| Pure utilities / schema / format    | `tests/<domain>/`    | нет                        |
| Module integration (parser, builder)| `tests/<domain>/`    | FS через `tmpdir`          |
| CLI command                         | `tests/cli/`         | `globalThis.fetch`, tmp DB |
| Cross-module integration            | `tests/integration/` | `globalThis.fetch`         |
| UI backend (Hono)                   | `tests/ui/`          | in-process `app.request()` |
| UI frontend (SPA, navigation)       | Playwright e2e       | реальный браузер           |
| Real-process smoke                  | `tests/cli/cli-smoke`| `Bun.spawn`                |

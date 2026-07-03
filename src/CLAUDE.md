# src/ — architecture map

Этот файл — точка входа в **код** zond. Workspace-контракт (`.api-fixtures.yaml` vs `.env.yaml`) — в [`../AGENTS.md`](../AGENTS.md), пользовательский CLI-референс — в [`../ZOND.md`](../ZOND.md).

zond — API hygiene scanner. **Dumb-tool**: умеет дёргать API, собирать evidence, проверять конформность спеки. Не зовёт LLM, не делает решения — это работа агента, который скармливает zond'у YAML и читает обратно отчёты.

## Top-level layout

| Каталог | Назначение |
|---|---|
| `cli/` | CLI surface: парсинг argv, регистрация команд, форматирование вывода. |
| `core/` | Бизнес-логика: probes, checks, generators, runner, reporters. **Никакой зависимости от commander/process.argv** — это переиспользуемое ядро. |
| `db/` | SQLite-слой: schema, migrations, queries для истории runs/results. |

**Правило**: `cli/commands/<cmd>.ts` парсит флаги и зовёт функции из `core/`. Бизнес-логика в `cli/` — code-smell (см. ARV-257 про `bootstrap.ts`/`discover.ts`, которые лежат в `cli/commands/` но не регистрируют команды).

## cli/

| Файл | Что |
|---|---|
| `index.ts` | Entry point бинаря. |
| `program.ts` | Commander root: регистрирует все top-level команды. |
| `argv.ts`, `resolve.ts` | Аргумент-парсинг и `--api` chain resolution (per-command > global > `ZOND_API` > `.zond/current-api`). |
| `runtime.ts` | Глобальный runtime context (`api`, workspace paths, http auditor). |
| `output.ts`, `json-envelope.ts`, `json-schemas.ts` | Forматирование результатов: текстовый/JSON envelope + Ajv-валидация envelope-схем. |
| `status-filter.ts` | Общий парсер `--status` фильтров. |
| `commands/` | Один файл на команду; `commands/init/`, `commands/api/`, `commands/probe/` — кластеры с subcommands. |

Контракт команды: парсит флаги, валидирует через зависимости из `core/`, эмиттит результат через `output.ts` (envelope) или streaming-репортер.

## core/ — подсистемы

| Подкаталог | Роль |
|---|---|
| `parser/`, `spec/` | Парсинг OpenAPI, dereferenced spec.json, extraction схем. |
| `generator/` | Синтез тестовых YAML-сьютов из spec: `suite-generator.ts`, `data-factory.ts`, `resources-builder.ts`. |
| `runner/` | HTTP-исполнение: `executor.ts`, retry, assertions, schema validation. |
| `checks/` | Schemathesis-style depth checks (status_code_conformance, response_schema_conformance, idempotency, …). Орк — `checks/runner.ts`. Один файл = один check class. |
| `probe/` | Активные security/mass-assignment probes. Сейчас два монолита (`security-probe.ts`, `mass-assignment-probe.ts`) — кандидаты на split (ARV-295, ARV-296). |
| `lint/` | Static spec-lint (`check spec`). Не путать с `checks/` — это разные команды и разные envelope'ы. |
| `diagnostics/` | Triage финдингов: классификация ошибок, hints, `recommended_action` mapping. |
| `severity/` | Per-finding severity calibration (ARV-283–288 актуализирует). |
| `anti-fp/` | Anti-false-positive guard'ы; registry-pattern частично (см. ARV-259). |
| `coverage/` | Покрытие endpoint'ов: test-runs + audit-runs, dual-metric. |
| `reporter/` | Форматирование `Run`/`Check`/`Probe` результатов в текст/JSON/NDJSON/SARIF/JUnit/HTML. |
| `exporter/` | HTML-отчёты, case studies. |
| `audit/` | Высокоуровневая `audit` команда — wraps checks + probe + report для CI-smoke. |
| `workspace/` | Layout API-папки: `apis/<name>/{spec,catalog,resources,fixtures,env,secrets}`. |
| `context/`, `identity/`, `secrets/` | Загрузка контекста запуска, identity tokens, секреты. |
| `util/`, `utils.ts` | Общие хелперы. URL/headers/schema-валидация частично дублируются с `probe/shared.ts` — кандидат на консолидацию (ARV-297). |
| `selectors/`, `meta/`, `classifier/` | Endpoint-classification и meta-аттрибуты для дискавери и группировки. |
| `setup-api.ts` | Регистрация нового API в workspace (used by `add api`/`refresh-api`). |

## db/

SQLite на bun. `migrations/` — versioned migrations, `schema.ts` — текущий schema, `queries/` — типизированные SQL. Используется reporter'ами и `coverage` для исторических runs. Retention (ARV-266): `zond db stats` — счётчики строк per `run_kind`; `zond db prune` — opt-in удаление (per-kind defaults: check/probe/request/fixture старше 7d, `regular` — forever; `--older-than 30d` для uniform-cutoff), VACUUM после delete.

## Data-flow по фазам

zond работает по 5 фазам — это ментальная модель CLI и skills:

```
Setup ──► Generate ──► Run ──► Analyze ──► Report
```

| Фаза | Команды | Что происходит | Артефакты |
|---|---|---|---|
| **Setup** | `init`, `add api`, `refresh-api`, `use`, `doctor`, `prepare-fixtures` | Регистрируем API, тянем spec, заполняем `.env.yaml`. | `apis/<name>/{spec.json, .api-catalog.yaml, .api-resources.yaml, .api-fixtures.yaml, .env.yaml}` |
| **Generate** | `generate`, `api annotate`, `prepare-fixtures` | Синтез тестовых YAML из spec + аннотации (seed-bodies, idempotency, pagination, lifecycle). | `apis/<name>/tests/*.yaml`, annotations |
| **Run** | `run`, `session`, `request`, `audit`, `checks run`, `probe <class>` | Дергаем API: тесты, depth-checks, probes. Пишем runs/results в SQLite. | `runs/` (DB), HTTP-аудит |
| **Analyze** | `coverage`, `db {runs,run,collections,diagnose,compare}`, `check spec`, `describe`, `catalog` | Триаж результатов, coverage-гэпы, lint спеки. Финдинги через `recommended_action`. | Envelope JSON, finding-streams |
| **Report** | `report`, `report-bundle`, `--report {json,ndjson,sarif,junit,html,markdown}` | Конвертация runs/findings в shareable форматы. | NDJSON-stream, SARIF, HTML, JUnit |

Полная картина с iron-rules и pre-flight checklist'ами — в skill-документах (`src/cli/commands/init/templates/skills/*.md`), которые ставятся через `zond init`.

## Extension points

Когда добавляешь новую функциональность — это **типичные точки расширения**:

| Хочу добавить | Куда |
|---|---|
| Новый depth-check (schemathesis-style) | `core/checks/checks/<name>.ts` + регистрация в `core/checks/runner.ts`. |
| Новый probe-class (security/mass-assignment-like) | `core/probe/<class>/` подмодуль; subcommand в `cli/commands/probe/`. Не клади всё в один монолит — см. ARV-295/ARV-296. |
| Новый reporter format | `core/reporter/<format>.ts`; зарегистрировать в `cli/output.ts` или per-command `--report`. |
| Новый CLI флаг с envelope-выводом | `cli/commands/<cmd>.ts` + Ajv-схема в `cli/json-schemas.ts`. Envelope shape — единый, не плоди вариации. |
| Анти-FP guard для check/probe | `core/anti-fp/rules/<rule>.ts` (registry-pattern в развитии — ARV-259). |
| Новая diagnostic-hint | `core/diagnostics/` — closed-enum `recommended_action`, не магические строки. |
| Новая DB-сущность | `src/db/migrations/<NNNN>-<name>.sql` + tiped query в `db/queries/`. |

## Workspace contract (ссылка)

Артефакты в `apis/<name>/` (`spec.json` / `.api-catalog.yaml` / `.api-resources.yaml` / **`.api-fixtures.yaml` manifest** / **`.env.yaml` values**) — описаны в [`../AGENTS.md`](../AGENTS.md). Главное правило: **manifest — source of truth о списке переменных, env — только values**.

## Conventions

- TypeScript strict mode, `bun run check` = `tsc --noEmit` без warnings (`noUnusedLocals`/`noUnusedParameters` включены).
- Тесты — `bun test` (unit + integration), `bun run test:mocked` (HTTP-mocked).
- Сборка — `bun run build` → single-file `dist/zond` бинарь.
- Никаких `console.log` в `core/` — выводи через `cli/output.ts` или reporter slot.
- Никаких SDK Anthropic/Ollama/прочих LLM-провайдеров внутри zond — это dumb-tool (см. `feedback_zond_no_llm_calls`).
- Финдинги — через closed-enum `recommended_action`, агент триажит по enum, не по тексту message.

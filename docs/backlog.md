# zond — Backlog (на основе анализа Backlog.md)

## Контекст

Анализ репозитория [MrLesk/Backlog.md](https://github.com/MrLesk/Backlog.md) (Bun + TS, ~5.4k★).
Стек одинаковый — идеи переносимые. Главный архитектурный пропуск zond —
ставка на Claude Code-плагин вместо MCP-сервера. Backlog.md ушёл на MCP и держит
**один бинарник = CLI + MCP + web + контент-ресурсы + один номер версии**, что
снимает drift и проблему обновления плагина.

## Архитектурные принципы (фиксируем перед задачами)

1. **Один бинарник, один source tree, одна версия.** CLI и MCP — два entry-point
   поверх общего `src/core/*`. Drift физически невозможен.
2. **Write остаётся за агентом.** YAML-тесты, .env.yaml, fixtures —
   через Read/Write/Edit. MCP-обёртки для редактирования файлов **не делаем**.
3. **MCP-тулза существует, только если возвращает structured-результат, который
   агенту иначе пришлось бы парсить из stdout.** Run, diagnose, describe, query DB,
   request — да. Create/edit YAML — нет.
4. **Скилл-контент живёт как MCP-ресурсы внутри бинарника**, не как файлы на
   диске. Грузится по запросу, не всегда в системном промпте.
5. **CLI — для людей и CI.** Все агентские флоу проходят через MCP, всё остальное
   — через CLI. Оба зовут общее ядро.

## Явные non-goals (не делать, проверено в анализе)

- React 19 SPA для дашборда — текущий HTMX+Hono сильнее под наш read-mostly
  сценарий.
- TUI на blessed — нет аналога Kanban-канбана, +1MB к бинарнику без выгоды.
- Filesystem-only mode без SQLite — runs машинные, нужен JOIN.
- Zero-padded id (`run-001`) — косметика без выгоды.
- MCP-обёртки `zond_create_test`, `zond_edit_yaml` — Write справляется.

---

# Фаза 0 — Быстрые победы (без зависимостей)

## T1. Заменить ручной parseArgs на commander

**Зачем.** `src/cli/index.ts` ~600 строк, из них ~300 — кастомный парсер с
ре-парсингом argv для повторяемых флагов (`--tag`, `--header`, `--env-var`).
Класс багов, который не нужно поддерживать.

**Что.**
1. Добавить `commander@^14` в dependencies.
2. Переписать `src/cli/index.ts` через `Command` API. Каждая команда —
   собственный `program.command(...)`. `--tag`/`--header`/`--env-var` — через
   `.option('--tag <t>', ..., collect, [])`.
3. Сохранить MSYS-фикс как pre-processor над `process.argv` до передачи в
   commander (флаги `--path`, `--json-path`).
4. Help/version отдаются commander-ом.

**Файлы.** `src/cli/index.ts`, `package.json`.

**Приёмка.** Все тесты `tests/cli/*.test.ts` зелёные без правок (значит, поведение
сохранено). LOC файла `src/cli/index.ts` снижается с ~600 до ~250.

**Размер.** S.

## T2. Канонизировать source-of-truth для OpenAPI-спеки

**Зачем.** Сейчас два места: `collections.openapi_spec` (SQLite) и
`.zond-meta.json → specUrl`. SKILL.md явно описывает «если разъехались —
ре-генерируй». Это плохой запах.

**Что.**
1. Канон — БД (`collections.openapi_spec`). `.zond-meta.json` оставить только
   для `specHash` (детектор drift), убрать `specUrl`.
2. Все чтения `specUrl` из `.zond-meta.json` → читать из БД через
   `findCollectionByNameOrId`.
3. Миграция: при старте, если `.zond-meta.json.specUrl` есть, а в БД нет — записать
   в БД, поле из JSON убрать.

**Файлы.** `src/core/meta/meta-store.ts`, `src/core/generator/index.ts`,
`src/core/sync/spec-differ.ts`, упоминания в `skills/api-testing/SKILL.md`
(потом переедут в ресурс).

**Приёмка.** Тесты `tests/integration/sync.test.ts` зелёные. В коде нет ни одного
чтения `.zond-meta.json.specUrl` после миграции.

**Размер.** S.

## T3. Удалить алиас `zond ui`

**Зачем.** Дублирующее имя для `serve --open`. Когнитивный шум.

**Что.** В `src/cli/index.ts` убрать ветку `case "ui"`. В `printUsage` убрать
строку `zond ui`. README/ZOND.md обновить.

**Файлы.** `src/cli/index.ts`, `ZOND.md`, `docs/quickstart.md`.

**Приёмка.** `zond ui` падает с unknown command. `zond serve --open` работает как
раньше.

**Размер.** S.

## T4. Shell-completions — `zond completions <bash|zsh|fish>`

**Зачем.** DX. У Backlog.md есть, у zond — нет.

**Что.** После T1: commander умеет генерить completions. Завернуть в
`zond completions <shell>`, печатать в stdout. README — секция установки.

**Файлы.** `src/cli/commands/completions.ts` (новый), `src/cli/index.ts`,
`README.md`.

**Зависит от.** T1.

**Приёмка.** `zond completions zsh > _zond` даёт рабочий completion-скрипт.

**Размер.** S.

---

# Фаза 1 — MCP-фундамент (центральная задача)

## T5. Добавить `zond mcp start` — entry-point MCP-сервера

**Зачем.** Снять привязку к Claude Code-плагину, дать портативность на Cursor,
Codex, Gemini CLI, Kiro.

**Что.**
1. Добавить `@modelcontextprotocol/sdk` в dependencies.
2. Создать `src/mcp/server.ts` — `startMcpServer({stdio: true})`.
3. Создать команду `src/cli/commands/mcp.ts` с подкомандой `start`.
4. Зарегистрировать в `src/cli/index.ts`.
5. Обработка `--db <path>` для общей БД.
6. На запуске — стандартный MCP handshake (`initialize`, `tools/list`,
   `resources/list`).

**Файлы.** `src/mcp/server.ts`, `src/mcp/index.ts`, `src/cli/commands/mcp.ts`,
`src/cli/index.ts`, `package.json`.

**Приёмка.** `echo '{"jsonrpc":"2.0","id":1,"method":"initialize",...}' | zond mcp start`
отдаёт корректный response. `tools/list` и `resources/list` работают (пусть с
заглушкой).

**Размер.** M.

## T6. Слой MCP-тулз поверх общего core

**Зачем.** Дать агенту типизированные тулзы вместо bash-обёрток. Тонкие, без
дублирования логики.

**Что.** В `src/mcp/tools/` — по файлу на тулзу. Каждая делегирует в существующие
`src/core/*` функции, как это делают `src/cli/commands/*.ts`. Список:

| Тулза | Делегирует в | Возвращает |
|---|---|---|
| `zond_init` | `src/core/setup-api.ts` | collection record |
| `zond_describe` | `src/core/generator/describe.ts` | endpoint info |
| `zond_catalog` | `src/core/generator/catalog-builder.ts` | catalog yaml текстом |
| `zond_run` | `src/core/runner/execute-run.ts` | run id + summary |
| `zond_diagnose` | `src/core/diagnostics/db-analysis.ts` | structured diagnosis |
| `zond_request` | `src/core/runner/http-client.ts` | response body+meta |
| `zond_coverage` | `src/core/generator/coverage-scanner.ts` | coverage report |
| `zond_db_runs` | `src/db/queries.ts` | список runs |
| `zond_db_run` | `src/db/queries.ts` | детали run |
| `zond_validate` | `src/core/parser/*` | validation report |
| `zond_sync` | `src/core/sync/spec-differ.ts` | diff |

**Не делаем (важно):** `zond_create_test`, `zond_edit_yaml`, `zond_write_env` —
это работа Write.

Каждая тулза — JSON-schema для inputs (Zod), structured ответ.

**Файлы.** `src/mcp/tools/*.ts` (по файлу на тулзу), `src/mcp/tools/index.ts`,
`src/mcp/server.ts`.

**Зависит от.** T5.

**Приёмка.** `tools/list` возвращает все тулзы со схемами. `tools/call zond_run`
исполняет тесты, `tools/call zond_diagnose` отдаёт ту же структуру, что
`zond db diagnose --json`.

**Размер.** L.

## T7. Слой MCP-ресурсов (workflow + правила + справочники)

**Зачем.** Заменить SKILL.md-файлы на on-demand ресурсы. Снизить размер
системного промпта, лочить контент к версии бинарника.

**Что.** В `src/mcp/resources/` — markdown-контент, экспортируемый через
`resources/list` + `resources/read`:

| URI | Замещает | Описание |
|---|---|---|
| `zond://workflow/test-api` | `skills/api-testing/SKILL.md` (Workflow) | основной флоу |
| `zond://workflow/scenarios` | `skills/api-scenarios/SKILL.md` | пользовательские сценарии |
| `zond://workflow/diagnosis` | `skills/test-diagnosis/SKILL.md` | разбор failure |
| `zond://workflow/setup` | `skills/setup/SKILL.md` | установка/обновление |
| `zond://rules/safety` | блок «NEVER do these» | --safe, --dry-run, CRUD-гарды |
| `zond://rules/never` | блок «MANDATORY NEVER» | критические запреты |
| `zond://reference/yaml` | блок YAML reference | формат, ассерты, generators |
| `zond://reference/auth-patterns` | блок auth setup | setup.yaml, capture |
| `zond://catalog/{api}` | runtime | `.api-catalog.yaml` для API |
| `zond://run/{id}/diagnosis` | runtime | готовая диагностика по run id |

Контент — markdown-файлы в `src/mcp/resources/content/*.md`, эмбедятся через
`with { type: "file" }` (как уже сделано для htmx/style.css).

**Файлы.** `src/mcp/resources/index.ts`, `src/mcp/resources/content/*.md`,
`src/mcp/server.ts`.

**Зависит от.** T5.

**Приёмка.** `resources/list` возвращает фиксированный набор + динамические
`zond://catalog/{api}` и `zond://run/{id}/diagnosis`. `resources/read` отдаёт
тело для каждого URI.

**Размер.** M.

## T8. `zond install --claude --cursor --codex --gemini`

**Зачем.** One-command onboarding под все MCP-агенты.

**Что.** Команда `zond install` детектит установленные агенты (наличие
`~/.claude/`, `~/.cursor/`, `~/.codex/` и т.п.) и предлагает прописать MCP-сервер
в их конфиги. Флаги — для явного выбора. По умолчанию — interactive prompt
(после T11).

Конфиг для Claude Code:
```jsonc
// ~/.claude/mcp.json
{ "mcpServers": { "zond": { "command": "zond", "args": ["mcp", "start"] } } }
```
Аналогично для остальных — формат у каждого свой, надо зашить шаблоны.

**Файлы.** `src/cli/commands/install.ts`, `src/cli/index.ts`,
`src/core/install/{claude,cursor,codex,gemini}.ts`.

**Зависит от.** T5.

**Приёмка.** `zond install --claude` создаёт/обновляет `~/.claude/mcp.json`,
запускает sanity-check `tools/list` через нового клиента.

**Размер.** M.

---

# Фаза 2 — Миграция со скиллов и плагина

## T9. Сжать `skills/*/SKILL.md` до тонких оркестраторов

**Зачем.** После T7 контент дублируется. Удалить дубль, оставить тонкую
маршрутизацию для агентов, у которых нет MCP.

**Что.** Каждый SKILL.md превратить в ~30 строк: «когда активироваться, какие
ресурсы фетчить, какие тулзы звать». Полный контент остаётся в MCP-ресурсе.

**Файлы.** `skills/api-testing/SKILL.md`, `skills/api-scenarios/SKILL.md`,
`skills/test-diagnosis/SKILL.md`, `skills/setup/SKILL.md`.

**Зависит от.** T7.

**Приёмка.** Каждый SKILL.md ≤ 60 строк. Содержит ссылки на ресурсы (`Fetch
zond://workflow/test-api before starting`) и список тулз.

**Размер.** S.

## T10. Решить судьбу `.claude-plugin/`

**Зачем.** Backlog.md обходится без плагина — MCP-сервер достаточно. Плагин
тяжело обновлять (см. жалобу пользователя).

**Что.** Два варианта на выбор:

**Вариант A — удалить.** Marketplace-листинг убрать, README направить на
`zond install --claude`. Плагин-маршрут — deprecated.

**Вариант B — оставить как 5-строчный шим.** В `plugin.json`:
- удалить `hooks` (они нужны были, потому что не было MCP);
- skills/commands оставить как fallback для пользователей без MCP;
- основной инсталл — через `zond install`.

Рекомендация: **A**, как только T5–T9 готовы и стабильны. До тех пор — B,
чтобы не ломать существующих пользователей.

**Файлы.** `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
`README.md`.

**Зависит от.** T5, T6, T7, T9.

**Приёмка.** Вариант A — `.claude-plugin/` удалён, README не упоминает
маркетплейс. Вариант B — плагин содержит только пойнтер на MCP-инсталл.

**Размер.** S.

## T11. Slash-команды (`/test-api`, `/diagnose`, `/smoke`)

**Зачем.** После MCP-инсталла Claude Code сам разберётся через тулзы и
ресурсы, slash-команды-обёртки не нужны.

**Что.** Удалить `commands/diagnose.md`, `commands/smoke.md`. `commands/test-api.md`
оставить как «human entry-point» (1-2 строки делегации в скилл) или удалить.

**Файлы.** `commands/*.md`, `.claude-plugin/plugin.json`.

**Зависит от.** T10 (вариант B), либо после A — с этим вообще пропадает.

**Приёмка.** В `commands/` либо пусто, либо один тонкий файл.

**Размер.** S.

---

# Фаза 3 — Конфиг и DX

## T12. `zond.config.yml` с уровневой precedence

**Зачем.** Сейчас в zond есть только `.env*.yaml` для переменных и SQLite —
для коллекций. Конфигурации проекта живут в флагах CLI/CI. Backlog.md имеет
`backlog.config.yml` с precedence `flags > config > defaults`.

**Что.** Создать `src/core/config/loader.ts`. Поиск в `cwd` и `cwd/..`. Поля:
```yaml
# zond.config.yml
default_reporter: console     # console | json | junit
default_safe: false           # require explicit --safe in CI
default_timeout_ms: 30000
default_tags: [smoke, setup]  # auto-include setup with smoke
db_path: zond.db
fail_on_coverage: 80          # для CI
dod:                          # см. T13
  - { type: response_time_ms, lt: 1000 }
  - { type: header, name: Content-Type, matches: "application/json" }
```

Все runtime-функции принимают `Config` объектом, формируемым:
1. `loadConfig()` (defaults → file → flags),
2. передача в `runCommand`/`coverageCommand` и т.д.

**Файлы.** `src/core/config/loader.ts`, `src/core/config/types.ts`,
обновления в `src/cli/commands/*.ts`.

**Приёмка.** Создание `zond.config.yml` с `default_safe: true` заставляет `zond run`
вести себя как `zond run --safe` без флага. CLI флаги перекрывают.

**Размер.** M.

## T13. Definition of Done для тестов (project-level ассерты)

**Зачем.** Аналог backlog DoD-defaults. «Любой ответ должен быть JSON и быстрее
1с» — повторяется в каждом suite, шумит. Лучше декларировать раз.

**Что.** В `zond.config.yml` секция `dod:` (см. T12). При запуске suite —
автоматически инжектится в каждый `expect:` block. Override на уровне теста:
`dod: false` или `dod: { skip: [response_time_ms] }`.

**Файлы.** `src/core/runner/executor.ts`, `src/core/runner/assertions.ts`,
`src/core/parser/schema.ts`.

**Зависит от.** T12.

**Приёмка.** Тесты `tests/runner/dod.test.ts` показывают, что DoD-ассерты
применяются ко всем тестам, кроме отмеченных `dod: false`.

**Размер.** M.

## T14. Интерактивный `zond init` через `@clack/prompts`

**Зачем.** Сейчас `init` — флаг-only. Для первого запуска (без AI-агента) это
неприветливо. clack даёт красивые prompt'ы.

**Что.**
1. `@clack/prompts` в dependencies.
2. Если флаги не переданы — запустить wizard:
   - text: «Имя API?» (default — title из спеки),
   - text: «Путь к OpenAPI-spec?»,
   - text: «base URL?» (default — из spec.servers[0]),
   - confirm: «Установить MCP в Claude Code?» (вызов `zond install --claude`).

Если флаги переданы — текущее поведение, без prompts.

**Файлы.** `src/cli/commands/init.ts`, `package.json`.

**Приёмка.** `zond init` без аргументов открывает wizard. `zond init --spec X
--name Y` — без prompts.

**Размер.** S.

## T15. `.zond-current` — текущий API в workspace

**Зачем.** При повторении `--api <name>` в каждой команде агент тратит
впустую. Backlog.md аналогично трактует «текущую задачу» как контекст.

**Что.** Создать `src/core/context/current.ts`. Файл `.zond-current` в `cwd`
содержит имя/id коллекции. Команды (`run`, `coverage`, `request`) при
отсутствии `--api` читают этот файл. `zond use <api>` — установить. `zond use --clear`
— удалить.

**Файлы.** `src/core/context/current.ts`, `src/cli/commands/use.ts`,
обновления в `run.ts`, `coverage.ts`, `request.ts`.

**Приёмка.** `zond use petstore && zond run` работает без `--api petstore`.

**Размер.** S.

---

# Фаза 4 — Web UI

## T16. Cmd+K палитра / fuzzy search

**Зачем.** Дашборд имеет 4 вкладки и растёт. На больших проектах поиск
становится узким местом.

**Что.**
1. `fuse.js` в dependencies (~10KB gzipped).
2. Один HTML-input в navbar + хоткей `Cmd/Ctrl+K`.
3. Индекс собирается на стороне сервера (endpoints, suites, runs, latest failed
   steps), отдаётся одним JSON. Клиентский Fuse делает фильтрацию.
4. Каждый результат — ссылка на конкретную страницу.

**Файлы.** `src/web/views/layout.ts`, `src/web/views/search.ts` (новый),
`src/web/routes/api.ts` (endpoint `/api/search-index`),
`src/web/static/style.css`.

**Приёмка.** Cmd+K открывает overlay, по запросу из 2+ символов показывает
ranked-список. Клик — навигация.

**Размер.** M.

---

# Зависимости

```
T1 ──────┐
T2 ──────┤
T3 ──────┼─ Фаза 0
T4 ←T1 ──┘

T5 ──────┐
T6 ←T5   │
T7 ←T5   ├─ Фаза 1 (MCP)
T8 ←T5   │
         │
T9  ←T7  ┐
T10 ←T6,T7,T9 ├─ Фаза 2
T11 ←T10 ┘

T12 ─────┐
T13 ←T12 ├─ Фаза 3
T14      │
T15      ┘

T16 ─────── Фаза 4
```

# Релизный поток (целевой, после T5–T10)

- `bun run build` — собирает CSS, потом `bun build --compile` → `dist/zond`.
  В бинарнике: CLI + MCP + web + ресурсы (markdown-контент).
- `npm publish` — публикует тонкий shim-пакет (как `scripts/cli.cjs` у Backlog.md),
  который спавнит платформенный бинарник из подпакета.
- Платформенные подпакеты `@kirrosh/zond-{darwin,linux,win32}-{arm64,x64}` —
  раздельные npm-пакеты, у каждого только один бинарь.
- Версия — одна на всё (`package.json`). Скрипт `version:sync` сейчас уже
  синхронизирует `.claude-plugin/plugin.json` — после T10 эта связь упрощается.

# Открытые вопросы

1. **Метаданные .api-catalog.yaml.** Сейчас лежит файлом в tests-dir. После
   T7 — хочется, чтобы catalog для API был ресурсом `zond://catalog/{api}`,
   но `.api-catalog.yaml` тоже остаётся (нужен агенту без MCP). Допустимое
   дублирование или общий генератор?
2. **Версионирование MCP-тулз.** При breaking-change сигнатуры — менять имя
   (`zond_run` → `zond_run_v2`) или резать совместимость по semver zond?
3. **Где хранить run-id для последующих команд.** Сейчас агент сам передаёт.
   Можно завести `zond://run/latest` ресурс, но это уже magic.
4. **Безопасность MCP-тулзы `zond_request`.** Произвольные HTTP-запросы внутри
   MCP — стоит ли позволять, или этот путь только через CLI с явным
   подтверждением?

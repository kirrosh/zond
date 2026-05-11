# AGENTS.md

Этот файл — точка входа для AI-агентов (Claude Code, Codex, Cursor, Aider, etc.),
работающих с репозиторием zond.

## Project overview

`zond` — AI-native API testing tool. См. [README.md](README.md), полный CLI-референс
в [ZOND.md](ZOND.md), внутренние документы — в `docs/`.

## Workspace contract (читай перед любым изменением fixture-pipeline)

`apis/<name>/` содержит четыре артефакта с **разными ролями**. Путать
их — это #1 источник багов в discover/seed/generate (см. feedback-13/14
finding'и). Источник правды — [decision-7](backlog/decisions/decision-7%20-%20API-artifacts-and-skill-split.md).

| Файл | Роль | Кто пишет | Кто читает |
|---|---|---|---|
| `spec.json` | Авторитет про **shape** API (dereferenced OpenAPI). | `add api` / `refresh-api` | `probe-*`, `generate`, `data-factory` |
| `.api-catalog.yaml` | Human/agent-readable **индекс** endpoint'ов с compressed schemas. | `add api` / `refresh-api` | skills, `describe` |
| `.api-resources.yaml` | CRUD-цепочки + FK + ETag/soft-delete. | `add api` / `refresh-api` | `generate`, `prepare-fixtures`, scenarios skill |
| **`.api-fixtures.yaml`** | **MANIFEST: список required vars** (path / auth / server / header / body-fk) с источником каждой. **Read-only**, regenerated. | `add api` / `refresh-api` / `generate` (расширяет список) | `prepare-fixtures` (итерируется по entries), `doctor`, scenarios skill |
| **`.env.yaml`** | **VALUES: значения** для переменных из manifest'а. **User-editable**, seeded из manifest'а. | user, `prepare-fixtures` (заполняет values) | runner, `executor`, `request` |

### Главное правило

**`.api-fixtures.yaml` — единственный источник правды о *списке*
переменных. `.env.yaml` хранит только *значения*.**

- `generate` обнаружил новый `{{var}}` в request-body? → расширить
  **manifest**, не env.
- `prepare-fixtures` хочет узнать, какие vars заполнять? → читать
  **manifest entries**, не env keys.
- В env есть ключ, которого нет в manifest? → это legacy/теневой
  ключ, печатается warning'ом и игнорируется.
- В тесте есть `{{var}}`, которой нет в manifest? → это **баг** в
  manifest builder'е или generator'е, не «надо добавить в env».

Любое предложение «generate должна синхронизировать .env.yaml» или
«discover ходит по env-keys» — **отвергнутый дизайн**, ведущий к двум
расходящимся источникам правды (см. feedback-13 F1+F2 как иллюстрацию).

### Fixture & env flow (как заполнять `.env.yaml`)

Канонический loop, который заменил пары `bootstrap` + `discover`:

| Шаг | Команда | Читает | Пишет |
|---|---|---|---|
| 1. Gap-отчёт | `zond doctor --api <name> --missing-only` | manifest + env | — |
| 2. Manifest (опц.) | `cat apis/<name>/.api-fixtures.yaml` | manifest | — |
| 3. Заполнить values | `zond prepare-fixtures --api <name> --apply [--seed] [--cascade]` | manifest + live API | `.env.yaml` (+`.bak`) |

`--seed` — новинка vs старого `discover`: когда list endpoint возвращает
`200 []`, POST-создаёт ресурс из schema-derived body и забирает его id.
На prod/shared org — сперва `--dry-run`.

**Что `zond init` НЕ делает.** Init — это только воркспейс-рефрешер:
обновляет `zond.config.yml`, `AGENTS.md`, `.claude/skills/`, маркер
`apis/`. Он **не трогает** `.env.yaml`, **не пересобирает** manifest, **не
вызывает** `doctor`/`prepare-fixtures`. Re-run `zond init` после
обновления CLI — безопасно и ожидаемо (подтянет новые скилл-файлы);
фикстуры останутся как были. Заполнение `.env.yaml` — только через
3-шаговый цикл выше.

**Что `zond add api` делает.** Регистрирует API, кладёт `spec.json` +
эмиттит `.api-fixtures.yaml` (manifest) + сидит скелетный `.env.yaml`
с пустыми плейсхолдерами. Доктор после `add api` покажет всех required
vars в статусе UNSET — это нормально, дальше идёт `prepare-fixtures`.

## Backlog (project tasks)

Все задачи проекта живут в `backlog/` и управляются [Backlog.md](https://backlog.md).
Конфиг — `backlog/config.yml`.

Для работы с бэклогом используй CLI:
`bunx backlog --help`, `bunx backlog task list --plain`,
`bunx backlog task <id> --plain` и т.д. CLI — единственная поддерживаемая
поверхность интеграции (см. [decision-2](backlog/decisions/decision-2%20-%20Drop-MCP-server-—-keep-CLI-agent-skills-as-the-only-integration-surface.md)).

### Workflow при запросе «возьми задачу» / «следующая задача» / «работай над <T-id>»

1. Загрузи описание процесса: `bunx backlog --help`.
2. Найди подходящую задачу: `bunx backlog task list --plain --status "To Do"`.
   Уважай `dependencies` — не бери задачу с незакрытыми блокерами.
3. Возьми её в работу: смени статус на `In Progress`, при необходимости
   проставь `assignees: ["@claude"]`.
4. Работай обычным циклом zond (Read → Plan → Edit → tests → build).
5. Сверься с `acceptance_criteria` — каждый пункт отметь выполненным.
6. Перед финальным коммитом — статус `Done`. Коммит делай сам в стиле
   репозитория (`feat:` / `refactor:` / `docs:` / `chore:`). Backlog НЕ коммитит
   автоматически (`auto_commit: false` в конфиге).

### Формат коммитов

Если работа закрывает (или продвигает) задачу из backlog —
**`TASK-<N>: <короткий subject>`**. Префикс `TASK-<N>` даёт прямую связку
«коммит ↔ задача» при чтении `git log --oneline`. Subject — короткий, в
повелительном наклонении, на английском (как остальные коммиты репо).

Примеры:

```
TASK-49: add probe-validation negative-input generator
TASK-1: migrate CLI to commander, preserve all semantics
TASK-3: remove zond ui alias
```

Если коммит затрагивает несколько задач — перечисляем через запятую
(`TASK-5, TASK-7: <subject>`) или выносим список в trailer тела:

```
Refs: TASK-5, TASK-7
```

Для мелких хотфиксов, опечаток и работ вне backlog — обычный
conventional-commits стиль (`feat:` / `refactor:` / `docs:` / `chore:`),
без `TASK-`.

## Depth checks (m-15)

Помимо YAML smoke / CRUD-тестов, у zond есть schemathesis-style каталог
«depth checks» — proactive conformance + security probes. Запускаются
через отдельную команду:

```bash
zond checks list                                 # каталог: id, severity, default expected
zond checks run --api myapi                      # examples-фаза, mode=all (default)
zond checks run --api myapi --phase coverage     # детерминированные boundary-values
zond checks run --api myapi --mode negative      # только malicious-input probes
zond checks run --api myapi --report sarif --output zond.sarif
                                                  # SARIF v2.1.0 для GitHub Code Scanning
zond checks run --api myapi --workers auto       # параллелизм по операциям (= min(cpus, 8))
zond checks run --api myapi --ndjson | jq -c '.' # стримить события (check_start/result/finding/summary)
```

Каждый `CheckFinding` несёт closed-enum `recommended_action` — агент
триажит по нему, а не по тексту message:

| `recommended_action` | Что делать |
|---|---|
| `report_backend_bug` | 5xx / leak after delete / accepted bogus auth — баг сервера. |
| `fix_spec` | Сервер ведёт себя разумно, но spec не описывает — обновить OpenAPI и `zond refresh-api`. |
| `tighten_validation` | Сервер принял невалидное тело — backend должен реджектить (400/422). |
| `add_required_header` | Заголовок помечен `required: true`, сервер не enforce — починить server либо relax spec. |
| `fix_auth_config` | Auth-проблема — проверить `apis/<name>/.env.yaml` (`auth_token`/`api_key`). |
| `fix_network_config` | Транспорт (timeout / DNS / refused) — проверить `base_url`. |

Подробный гайд для агента — в скилле `zond-checks` (создаётся при
`zond init`). Полный CLI-референс — в [ZOND.md](ZOND.md#checks-run--schemathesis-style-depth-checks-m-15).

## Историческая справка

Источник правды по задачам — `backlog/` (Backlog.md CLI). Активные
архитектурные решения лежат в `backlog/decisions/`.

## Развитие zond

Репозиторий — bun-only (`bun >= 1.1`). Полезные команды:

```bash
bun install            # установка зависимостей
bun test               # вся тестовая матрица
bun run check          # tsc --noEmit
bun run build          # компиляция бинаря
bun run zond -- ...    # запустить CLI из исходников
```

CI и release-flow описаны в `docs/ci.md` и в самом `package.json`
(`version:sync`, `postversion`).

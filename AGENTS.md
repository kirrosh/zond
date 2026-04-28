# AGENTS.md

Этот файл — точка входа для AI-агентов (Claude Code, Codex, Cursor, Aider, etc.),
работающих с репозиторием zond.

## Project overview

`zond` — AI-native API testing tool. См. [README.md](README.md), полный CLI-референс
в [ZOND.md](ZOND.md), внутренние документы — в `docs/`.

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

## Историческая справка

До подключения Backlog.md план держался в `docs/backlog.md`. Сейчас этот файл
сжат до указателя; источник правды — `backlog/`. Архитектурные принципы
вынесены в `backlog/decisions/`.

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

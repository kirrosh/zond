# AGENTS.md

Этот файл — точка входа для AI-агентов (Claude Code, Codex, Cursor, Aider, etc.),
работающих с репозиторием zond.

## Project overview

`zond` — AI-native API testing tool. См. [README.md](README.md), полный CLI-референс
в [ZOND.md](ZOND.md), внутренние документы — в `docs/`.

## Backlog (project tasks)

Все задачи проекта живут в `backlog/` и управляются [Backlog.md](https://backlog.md).
Конфиг — `backlog/config.yml`.

**Если клиент поддерживает MCP** — читай ресурс `backlog://workflow/overview`
для полной инструкции (она лежит в самом сервере и обновляется вместе с
версией backlog). MCP-сервер описан в `.mcp.json`.

**Если MCP недоступен** — выполни `bunx backlog --help` и далее работай через
CLI: `bunx backlog task list --plain`, `bunx backlog task <id> --plain` и т.д.

### Workflow при запросе «возьми задачу» / «следующая задача» / «работай над <T-id>»

1. Загрузи описание процесса (см. выше — MCP-ресурс или CLI-help).
2. Найди подходящую задачу: `backlog.task_list` (MCP) или
   `bunx backlog task list --plain --status "To Do"`. Уважай `dependencies` —
   не бери задачу с незакрытыми блокерами.
3. Возьми её в работу: смени статус на `In Progress`, при необходимости
   проставь `assignees: ["@claude"]`.
4. Работай обычным циклом zond (Read → Plan → Edit → tests → build).
5. Сверься с `acceptance_criteria` — каждый пункт отметь выполненным.
6. Перед финальным коммитом — статус `Done`. Коммит делай сам в стиле
   репозитория (`feat:` / `refactor:` / `docs:` / `chore:`). Backlog НЕ коммитит
   автоматически (`auto_commit: false` в конфиге).

Для мелких хотфиксов и опечаток задачу заводить не нужно — работай как обычно.

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

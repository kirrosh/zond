# zond — Backlog

Бэклог живёт в [`backlog/`](../backlog/) и управляется
[Backlog.md](https://backlog.md). Сам инструмент — devDependency
(см. [`package.json`](../package.json)).

## Команды

```bash
bunx backlog board                       # терминальный канбан
bunx backlog browser                     # web UI на localhost:6420
bunx backlog task list --plain           # список задач, сгруппированных по статусу
bunx backlog task TASK-5 --plain         # детали конкретной задачи
bunx backlog sequence list --plain       # граф зависимостей
```

Шорткаты: `bun backlog`, `bun board`.

## Структура

- `backlog/tasks/` — активные задачи.
- `backlog/archive/` — закрытые/неактуальные задачи и milestones.
- `backlog/decisions/` — архитектурные решения (см. ниже).
- `backlog/milestones/` — текущие группировки (`m-3` UX polish,
  `m-4` bug-hunting capabilities).
- `backlog/config.yml` — `auto_commit: false`, `remoteOperations: false`,
  `checkActiveBranches: false` (последние два выключены, чтобы CLI не дёргал
  SSH-fetch на каждом действии).

## Действующие архитектурные решения

| Decision | Суть |
|---|---|
| [decision-1](../backlog/decisions/decision-1%20-%20Architecture-principles-for-backlog-migration.md) | **superseded by decision-2.** Исторический контекст: один бинарник, write — за агентом. |
| [decision-2](../backlog/decisions/decision-2%20-%20Drop-MCP-server-—-keep-CLI-agent-skills-as-the-only-integration-surface.md) | MCP выпилен. Surface = CLI + agent skills. |
| [decision-3](../backlog/decisions/decision-3%20-%20Future-of-zond-serve-web-UI.md) | `zond serve` сохраняем как human-only secondary surface (revisitable). |
| [decision-4](../backlog/decisions/decision-4%20-%20Future-of-zond-export-postman.md) | `zond export postman` сохраняем как QA-onboarding мост (revisitable). |

## Workflow для агента

См. [`AGENTS.md`](../AGENTS.md) — там расписан цикл «возьми задачу → In
Progress → выполни → Done → коммит сами».

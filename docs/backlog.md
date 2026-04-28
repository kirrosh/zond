# zond — Backlog

Бэклог переехал в [`backlog/`](../backlog/) и управляется через
[Backlog.md](https://backlog.md). Сам инструмент стоит как devDependency
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

- `backlog/tasks/` — активные задачи (T-номер закодирован в `labels`).
- `backlog/decisions/` — архитектурные решения. Принципы миграции бэклога —
  в [`decision-1`](../backlog/decisions/decision-1%20-%20Architecture-principles-for-backlog-migration.md).
  Выпил MCP-сервера и переход на CLI-only — в
  [`decision-2`](../backlog/decisions/decision-2%20-%20Drop-MCP-server-—-keep-CLI-agent-skills-as-the-only-integration-surface.md).
- `.mcp.example.json` — **опциональный** шаблон конфигурации backlog-MCP
  для агентов, которые хотят работать с backlog через MCP-протокол.
  Скопируйте в `.mcp.json` (он в `.gitignore`) если вашему клиенту
  это удобно. zond сам по себе CLI-only — это не его интеграция.
- `backlog/config.yml` — `auto_commit: false`, `remoteOperations: false`,
  `checkActiveBranches: false` (последние два выключены, чтобы CLI не дёргал
  SSH-fetch на каждом действии).

## Карта T-номеров

| T | TASK | Фаза | Статус |
|---|------|------|--------|
| T1–T4 | TASK-1…4 | Phase 0 (быстрые победы) | Done |
| T5–T8 | TASK-5…8 | Phase 1 (MCP-фундамент, выпилен в decision-2) | Done (archived) |
| T9–T11 | TASK-9…11 | Phase 2 (миграция со скиллов и плагина) | To Do |
| T12–T15 | TASK-12…15 | Phase 3 (конфиг и DX) | To Do |
| T16 | TASK-16 | Phase 4 (Web UI) | To Do |

## Workflow для агента

См. [`AGENTS.md`](../AGENTS.md) — там расписан цикл «возьми задачу → In
Progress → выполни → Done → коммит сами».

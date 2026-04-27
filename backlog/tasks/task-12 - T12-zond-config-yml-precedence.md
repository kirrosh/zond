---
id: TASK-12
title: 'T12: `zond.config.yml` с уровневой precedence'
status: To Do
assignee: []
created_date: '2026-04-27'
labels:
  - T12
  - phase-3
  - size-M
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
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

**Размер.** M.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Создание `zond.config.yml` с `default_safe: true` заставляет `zond run` вести себя как `zond run --safe` без флага
- [ ] #2 CLI флаги перекрывают значения из конфига
<!-- AC:END -->

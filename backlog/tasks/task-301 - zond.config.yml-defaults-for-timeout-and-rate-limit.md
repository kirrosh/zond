---
id: TASK-301
title: 'zond.config.yml: defaults for --timeout and --rate-limit'
status: To Do
assignee: []
created_date: '2026-05-09 07:00'
labels:
  - cli-surface
  - consolidation
  - m-13
milestone: m-13
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас --timeout / --rate-limit повторяются в командах. Сделать defaults в zond.config.yml (workspace-level + per-API override). Per-command флаги остаются как override. Эффект: -200 LOC, меньше повторов. Источник: audit-and-consolidation.md §4.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 zond.config.yml поддерживает поля defaults.timeout, defaults.rate_limit
- [ ] #2 Команды читают defaults, если флаг не передан
- [ ] #3 Per-API override (apis/<name>/zond.config.yml или секция) работает
- [ ] #4 Документация обновлена
<!-- AC:END -->

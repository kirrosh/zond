---
id: TASK-293
title: >-
  JSON envelope on remaining commands (run, generate, probe-*, bootstrap,
  discover, clean, report-bundle)
status: To Do
assignee: []
created_date: '2026-05-09 07:00'
labels:
  - json
  - agent-first
  - m-13
milestone: m-13
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас --json есть только у 8 из 32 команд (vector-3 §4). Использовать готовый writeEnvelope() из TASK-184 и добавить --json для оставшихся. Stdout discipline: при --json только JSON в stdout, всё остальное в stderr. Источник: vector-3-agent-first.md §5 quick win #1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Все команды (кроме интерактивных, если такие есть) поддерживают --json
- [ ] #2 Snapshot-тесты envelope для каждой новой команды
- [ ] #3 ZOND.md / skills/zond.md перечисляет --json как supported
<!-- AC:END -->

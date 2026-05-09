---
id: TASK-296
title: 'errors[]: replace flat strings with {code, message, details}'
status: To Do
assignee: []
created_date: '2026-05-09 07:00'
labels:
  - json
  - agent-first
  - m-13
  - breaking
milestone: m-13
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас envelope.errors[] — массив строк, агент не может маршрутизировать. Сделать errors[]: {code: ZondErrorCode, message, details?}. ZondErrorCode — enum (env_missing, fixture_missing, network_timeout, sandbox_blocked, …). Связано с TASK-89 (exit-code taxonomy). Источник: vector-3-agent-first.md §4 (#4), §5 quick win #4.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ZondErrorCode enum экспортирован
- [ ] #2 errors[].code заполняется во всех командах с --json
- [ ] #3 writeEnvelope() принимает структурированные errors
- [ ] #4 Breaking-change запись в CHANGELOG (envelope schema bump)
<!-- AC:END -->

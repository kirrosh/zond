---
id: TASK-41
title: 'T41: Coverage сообщение для needs-id suites'
status: To Do
assignee: []
created_date: '2026-04-27 15:28'
labels:
  - coverage
  - ux
milestone: m-3
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`zond coverage` ругается на `required_params_no_examples` для эндпоинтов, для которых уже есть suite (smoke-positive со skip_if из T27). Сообщение путает: «covered» ли он на самом деле или нет?

## Что сделать

В `src/core/coverage/` (или где формируется сообщение): если для endpoint найден suite, но он `[needs-id]` и все шаги `skip_if`-блокированы → показывать статус «covered (positive skipped pending IDs)» вместо общего предупреждения.

Это требует, чтобы coverage-анализатор понимал tags и `skip_if` (сейчас он их, видимо, не видит).

## Acceptance

- Endpoint с positive-suite и пустым env_id → coverage = covered, со специальной пометкой "pending IDs".
- Без env-вара — сообщение объясняет, что нужно сделать.
<!-- SECTION:DESCRIPTION:END -->

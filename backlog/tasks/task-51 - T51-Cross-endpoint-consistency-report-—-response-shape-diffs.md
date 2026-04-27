---
id: TASK-51
title: 'T51: Cross-endpoint consistency report — response shape diffs'
status: To Do
assignee: []
created_date: '2026-04-27 16:43'
labels:
  - consistency
  - bug-hunting
milestone: m-4
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Live digest #06: 8 cross-endpoint несоответствий в Resend (auth 400 vs 401 от разных endpoints, DELETE contacts vs DELETE audiences shape, etc.). Это паттерны, которые видны только при сравнении ответов между endpoints.

## Что сделать

После прогона `zond run` команда `zond db consistency-report <run_id>`:

1. Группировать responses по семантически близким endpoints (например, все DELETE, все list-on-collection, все error-responses).
2. Сравнивать структуры:
   - Поля в success body: какие endpoints возвращают `{id, name}`, какие `{data: {id, name}}`?
   - Error shapes: всегда ли `{error: {message, code}}` или иногда `{message}`?
   - Status codes: 400 vs 401 vs 403 для одинакового класса auth-fail.
   - Header naming: X-Request-ID vs Request-ID.
3. Output: markdown-отчёт с группами различий + конкретные примеры.

## Acceptance

- На прогоне Resend ловит digest #06 несоответствия автоматически.
- Отчёт читаемый, можно отдать команде API.
- Не false-positive'ит на реально различные операции (POST vs DELETE shapes ожидаемо разные).
<!-- SECTION:DESCRIPTION:END -->

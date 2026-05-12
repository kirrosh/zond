---
id: ARV-110
title: >-
  zond request envelope shape inconsistent с/без --api (--json-path body.id
  ломается на bare URL)
status: Done
assignee: []
created_date: '2026-05-11 09:20'
updated_date: '2026-05-11 09:27'
labels:
  - zond
  - cli
  - request
  - envelope
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Поведение envelope в `zond request` зависит от того, передан ли `--api <name>` или используется bare URL.

С `--api` — JSON envelope содержит `body.id` (можно достать через `--json-path body.id`).
Без `--api` (bare URL) — тот же `--json-path body.id` возвращает пустоту, потому что envelope другой формы.

Это ломает скрипты harvest'а fixtures, когда нужно дёрнуть external ingest-эндпоинт по полному URL (например, Sentry's `https://o<org>.ingest.us.sentry.io/api/<project>/store/`) — там `--api` неприменим, и `--json-path` молча возвращает пусто.

Отличается от ARV-70 (там envelope ОК, но конкретные endpoint'ы возвращают пустой `data[0].id`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 envelope-shape одинаков с `--api` и без него
- [x] #2 `--json-path body.id` работает на bare URL
- [x] #3 added regression test: `zond request <bare-url>` → JSON envelope matches schema
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
F17 — envelope shape подтверждён идентичный с/без --api (regression test добавлен в tests/cli/request.test.ts). Симптом пользователя был от путаницы envelope (data.body.id) vs response body (--json-path body.id). Добавлена эвристика: когда --json-path начинается с 'body.' или 'data.' и failedAt — первый сегмент, печатается hint про envelope-vs-response-body. Также диагностика теперь печатается и в --json режиме (раньше только в pipe-friendly режиме). Docstring --json-path уточнён: 'extract from RESPONSE BODY (not zond envelope)'.
<!-- SECTION:NOTES:END -->

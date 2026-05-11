---
id: ARV-110
title: >-
  zond request envelope shape inconsistent с/без --api (--json-path body.id
  ломается на bare URL)
status: To Do
assignee: []
created_date: '2026-05-11 09:20'
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
- [ ] #1 envelope-shape одинаков с `--api` и без него
- [ ] #2 `--json-path body.id` работает на bare URL
- [ ] #3 added regression test: `zond request <bare-url>` → JSON envelope matches schema
<!-- AC:END -->

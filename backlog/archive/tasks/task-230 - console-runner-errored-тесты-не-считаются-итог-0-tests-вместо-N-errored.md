---
id: TASK-230
title: 'console-runner: errored тесты не считаются, итог 0 tests вместо N errored'
status: Done
assignee: []
created_date: '2026-05-08 07:56'
updated_date: '2026-05-08 08:03'
labels:
  - feedback-loop
  - api-sentry
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F3, class definitely_bug (укреплено в round-03#F3 через db run)
Repro: любой ран где endpoint падает с network/TLS error до response (напр. base_url с {region}); zond run apis/sentry/tests --safe
Expected: Results: 0 passed, 10 errored; Total: 0 passed, 30 errored, 10 skipped
Actual: per-suite строка Results: 0 tests (3.9s) — нет счётчика ошибок; Total: 10 skipped — 30 errored игнорированы; DB-layer честно хранит status: error для 23 тестов, но console и db runs показывают разные картины
Log: /tmp/zond-fb/sentry/rounds/raw-01.log (Results: в каждой suite + Total:)
<!-- SECTION:DESCRIPTION:END -->

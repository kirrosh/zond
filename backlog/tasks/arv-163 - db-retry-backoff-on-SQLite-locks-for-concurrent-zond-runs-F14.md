---
id: ARV-163
title: 'db: retry/backoff on SQLite locks for concurrent zond runs (F14)'
status: To Do
assignee: []
created_date: '2026-05-12 12:45'
labels:
  - feedback-loop
  - api-stripe
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback rounds 05–09, finding F14, class quirk/UX.

Repro: запустить параллельно
- terminal A: zond probe security ssrf,crlf,open-redirect --api stripe --include 'path:^/v1/(customers|charges)'
- terminal B: zond checks run --api stripe --phase coverage

Expected: операции не валятся, второй процесс ждёт или ретраит при коротком write-lock.
Actual: «Failed to resolve --api: database is locked». Воспроизводится также при concurrent generate + run в одной зонд-сессии (R05, R09).

Effect: tester вынужден сериализовать запуски руками, ломает попытку гнать probe-static + coverage-checks параллельно. Полностью блокирует concurrent fb-loop сценарий.

Fix: WAL + busy_timeout (5–10s) на open() + retry/backoff wrapper над write-tx-ями; для длинных запросов — chunked write. См. также ARV-127 (db migration runner) — место для централизованного db-open.

Log: ~/Projects/zond-test/.fb-loop/rounds/raw-09.log
<!-- SECTION:DESCRIPTION:END -->

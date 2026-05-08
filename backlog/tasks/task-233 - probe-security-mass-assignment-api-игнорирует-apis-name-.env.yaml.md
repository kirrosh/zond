---
id: TASK-233
title: probe security/mass-assignment --api игнорирует apis/<name>/.env.yaml
status: To Do
assignee: []
created_date: '2026-05-08 07:56'
labels:
  - feedback-loop
  - api-sentry
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F2, class definitely_bug (consistency)
Repro: zond probe security ssrf --api sentry --output /tmp/sec; zond probe mass-assignment --api sentry --output /tmp/ma
Expected: --api <name> везде означает одно и то же — читать apis/<name>/.env.yaml для base_url и auth
Actual: probe security: Error: base_url is required ... несмотря на apis/sentry/.env.yaml; probe mass-assignment: error: required option '--env <file>' not specified — CLI-валидатор срабатывает раньше --api логики
Workaround: явный --env apis/sentry/.env.yaml — обе команды работают
Log: /tmp/zond-fb/sentry/rounds/raw-04.log (=== probe security === + === probe mass-assignment ===)
<!-- SECTION:DESCRIPTION:END -->

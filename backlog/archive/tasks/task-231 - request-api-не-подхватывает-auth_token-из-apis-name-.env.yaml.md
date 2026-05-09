---
id: TASK-231
title: request --api не подхватывает auth_token из apis/<name>/.env.yaml
status: Done
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
Source: feedback round 03, finding F1, class missing-feature (likely_bug)
Repro: cd workdir && zond request GET https://us.sentry.io/api/0/organizations/ --api sentry
Expected: при --api sentry команда читает apis/sentry/.env.yaml и подмешивает Authorization: Bearer {{auth_token}}
Actual: запрос уходит без auth, получаем 401; auth_token нужно прописывать через --header каждый раз, что нарушает контракт .env.yaml как hidden secret
Log: /tmp/zond-fb/sentry/rounds/raw-03.log (первые два zond request вывода, оба 401)
Note: TASK-132 (Done) решил резолв base_url, но auth-инъекцию не покрыл
<!-- SECTION:DESCRIPTION:END -->

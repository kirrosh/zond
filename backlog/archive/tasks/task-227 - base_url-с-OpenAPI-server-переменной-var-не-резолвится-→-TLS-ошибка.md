---
id: TASK-227
title: 'base_url с OpenAPI server-переменной {var} не резолвится → TLS-ошибка'
status: Done
assignee: []
created_date: '2026-05-08 07:56'
updated_date: '2026-05-08 08:03'
labels:
  - feedback-loop
  - api-sentry
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F2, class ux-papercut + likely_bug
Repro: Свежий workspace, .env.yaml содержит base_url: 'https://{region}.sentry.io' (как сохранил zond add api); запустить zond run apis/sentry/tests --safe
Expected: zond add api подставляет default из servers[0].variables.region.default при записи .env.yaml; ИЛИ doctor помечает base_url как 'unset / contains unresolved {var}'; ИЛИ runner выдаёт чёткое 'base_url contains unresolved placeholder {region}'
Actual: .env.yaml сохраняется как https://{region}.sentry.io, doctor помечает ✓ base_url [server], zond run валит все тесты с 'Error: unknown certificate verification error' (невалидный hostname {region}.sentry.io маскируется под TLS-ошибку)
Log: /tmp/zond-fb/sentry/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->

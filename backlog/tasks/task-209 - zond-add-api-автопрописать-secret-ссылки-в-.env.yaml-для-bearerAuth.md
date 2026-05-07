---
id: TASK-209
title: 'zond add api: автопрописать @secret-ссылки в .env.yaml для bearerAuth'
status: Done
assignee: []
created_date: '2026-05-07 14:08'
updated_date: '2026-05-07 14:18'
labels:
  - feedback-loop
  - api-resend
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F1, class definitely_bug
Repro: zond add api resend --spec https://resend.com/openapi.json
Expected: .env.yaml содержит auth_token: "@secret:auth_token" автоматически (раз spec.securitySchemes.bearerAuth есть)
Actual: .secrets.yaml содержит auth_token: "", но .env.yaml пустой — все сьюты падают на Warning: Undefined variable {{auth_token}}, запросы без Authorization получают 400/401
Log: /tmp/zond-fb/resend/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->

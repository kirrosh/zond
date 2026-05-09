---
id: TASK-213
title: 'zond add api: stdout-инструкция по auth setup при наличии securitySchemes'
status: Done
assignee: []
created_date: '2026-05-07 14:09'
updated_date: '2026-05-07 14:18'
labels:
  - feedback-loop
  - api-resend
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F5, class ux-papercut
Repro: zond add api resend --spec https://resend.com/openapi.json -> stdout: Registered API 'resend' at ... (83 endpoints) / Artifacts: ...
Expected: если spec содержит securitySchemes -> stdout добавляет 'Auth required: add auth_token: "@secret:auth_token" to apis/resend/.env.yaml' (или автоматически прописывает — см. F1). zond doctor --api resend должен это поднимать
Actual: ничего о необходимости auth
Log: /tmp/zond-fb/resend/rounds/init.log
<!-- SECTION:DESCRIPTION:END -->

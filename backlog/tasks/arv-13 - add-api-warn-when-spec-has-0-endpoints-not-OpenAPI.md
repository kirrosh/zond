---
id: ARV-13
title: 'add api: warn when spec has 0 endpoints / not OpenAPI'
status: To Do
assignee: []
created_date: '2026-05-10 07:13'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F1, class ux-papercut
Repro: zond add api resend --spec https://api.resend.com
Expected: ошибка/предупреждение, что URL не похож на OpenAPI/Swagger spec; non-zero exit + 'spec не содержит paths' с подсказкой про info/openapi поле.
Actual: 'Registered API resend at .../apis/resend (0 endpoints)'. Никакого warning'а про подозрительно пустую спеку.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->

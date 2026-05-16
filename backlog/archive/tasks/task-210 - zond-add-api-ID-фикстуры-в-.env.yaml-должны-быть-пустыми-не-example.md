---
id: TASK-210
title: 'zond add api: ID-фикстуры в .env.yaml должны быть пустыми, не "example"'
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
Source: feedback round 01, finding F2, class definitely_bug
Repro:
1. zond add api resend --spec https://resend.com/openapi.json -> .env.yaml: log_id: example
2. zond run apis/resend/tests --tag smoke --safe
3. smoke-logs-positive.yaml содержит skip_if: "{{log_id}} ==" (пустая проверка)
4. "example" == "" -> false -> тест запускается -> GET /logs/example -> 422
Expected: согласно ZOND.md "auto-skips while the env var is empty (default after zond generate)" .env.yaml должен генерировать пустые строки для ID-полей, чтобы skip_if работал
Actual: placeholder "example" не пустой -> все positive/needs-id сьюты падают 422 вместо auto-skip
Log: /tmp/zond-fb/resend/rounds/raw-01c.log
<!-- SECTION:DESCRIPTION:END -->

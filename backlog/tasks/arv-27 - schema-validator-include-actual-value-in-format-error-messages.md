---
id: ARV-27
title: 'schema validator: include actual value in format error messages'
status: Done
assignee: []
created_date: '2026-05-10 08:27'
updated_date: '2026-05-10 08:30'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 06, finding F2, class ux-papercut
Repro: zond run apis/resend/tests/smoke-webhooks-positive.yaml --validate-schema → 'body.data.0.created_at: format "date-time"' (актуальное значение не показано)
Expected: 'body.data.0.created_at: expected format "date-time" but got "2026-04-28 07:18:18.314+00"' — так же, как уже делает status assert ('expected equals 200 but got 422')
Actual: одинаковые строки на каждый элемент массива без actual value, надо лезть в response руками
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-06.log (block 'N. --validate-schema error format detail')
<!-- SECTION:DESCRIPTION:END -->

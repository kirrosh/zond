---
id: TASK-220
title: 'generator: email-context fields (from/to/reply_to/cc/bcc) → randomEmail'
status: Done
assignee: []
created_date: '2026-05-07 14:55'
updated_date: '2026-05-07 15:05'
labels:
  - feedback-loop
  - api-resend
  - generator
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F12, class definitely_bug. Repro: zond generate -> crud-broadcasts.yaml from: {{randomString}} -> API 422 'Invalid from field. email needs to follow email@example.com format'. Same for reply_to/to/bcc/cc in emails-crud. Expected: when field name is from/to/reply_to/bcc/cc/email or schema has format:email -> use {{randomEmail}}. Actual: ignored, emits randomString. Log: /tmp/zond-fb/resend/rounds/raw-04.log; broadcasts-run.json
<!-- SECTION:DESCRIPTION:END -->

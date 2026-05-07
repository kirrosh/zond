---
id: TASK-223
title: 'generator: spec example UUID в FK-полях используется hardcoded (чужой акаунт)'
status: Done
assignee: []
created_date: '2026-05-07 14:56'
updated_date: '2026-05-07 15:05'
labels:
  - feedback-loop
  - api-resend
  - generator
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F15, class likely_bug. Repro: crud-contacts.yaml audience_id: '78261eea-8f8b-4381-83c6-79fa7120f1cf' (UUID из spec example, чужой акаунт). API 422. Expected: для FK-полей (имя оканчивается на _id и тип uuid) generator должен заменить example UUID на {{uuid}} или {{audience_id}} (capture/fixture). Actual: hardcoded UUID копируется как есть. Log: /tmp/zond-fb/resend/rounds/raw-04.log; contacts-run.json
<!-- SECTION:DESCRIPTION:END -->

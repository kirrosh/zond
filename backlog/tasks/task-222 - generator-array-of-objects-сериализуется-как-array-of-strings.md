---
id: TASK-222
title: 'generator: array of objects сериализуется как array of strings'
status: Done
assignee: []
created_date: '2026-05-07 14:56'
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
Source: feedback round 04, finding F14, class definitely_bug. Repro: crud-contacts.yaml -> segments: [{{randomString}}] -> array of strings. Spec: segments Array<{id:string,...}> (array of objects). API: 'Expected object, received string'. Expected: при items.type:object generator создает объект {id: {{uuid}}} вместо строки. Actual: items genrate fallback to string. Log: /tmp/zond-fb/resend/rounds/raw-04.log; contacts-run.json
<!-- SECTION:DESCRIPTION:END -->

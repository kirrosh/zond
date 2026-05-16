---
id: TASK-221
title: 'generator: type:object без properties не должен сериализоваться в null'
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
Source: feedback round 04, finding F13, class definitely_bug. Repro: zond generate -> crud-automations.yaml steps[0].config: null (YAML null for type:object field without example). Sent JSON: 'config':null -> API 422 'The steps, config field must be an object'. Expected: object schema без properties и без example -> {} либо поле опускается. Actual: null в YAML -> null в JSON -> 422. Log: /tmp/zond-fb/resend/rounds/raw-04.log; automations-run.json
<!-- SECTION:DESCRIPTION:END -->

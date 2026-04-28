---
id: TASK-MEDIUM.2
title: 'probe-validation: --tag filter is not applied (matches all endpoints)'
status: To Do
assignee: []
created_date: '2026-04-28 07:22'
updated_date: '2026-04-28 10:14'
labels:
  - bug-hunting
  - from-iteration-2
dependencies: []
parent_task_id: TASK-MEDIUM
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Context: invoking 'zond probe-validation resend-openapi.json --tag Webhooks --max-per-endpoint 8' produced 62 suites covering ALL endpoints in the spec (api-keys, automations, broadcasts, contacts, domains, emails, events, logs, segments, templates, topics, webhooks) — not just the ones tagged 'Webhooks'. --max-per-endpoint did clamp count, so generation works, but tag filtering is silently ignored. Suggested fix: in the operation-iteration step of probe-validation, filter operations whose 'tags' field does not intersect the --tag set; add a unit test using the resend OpenAPI fixture that asserts only Webhook-tagged paths are emitted when --tag Webhooks is passed. Make match case-insensitive to be friendly with mixed-case OpenAPI tag values.
<!-- SECTION:DESCRIPTION:END -->

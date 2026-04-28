---
id: TASK-HIGH.2
title: 'probe-validation: emit base_url + auth headers at suite level'
status: In Progress
assignee: []
created_date: '2026-04-28 07:22'
updated_date: '2026-04-28 07:35'
labels:
  - bug-hunting
  - from-iteration-2
dependencies: []
parent_task_id: TASK-HIGH
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Context: zond probe-validation generates suite YAML without a base_url field, so every probe fails with 'base_url is not configured' even when .env.yaml in the API collection root sets base_url. Observation (iteration-2 APPLY): all 604 probes for the Resend OpenAPI errored at network layer until I manually injected 'base_url: "{{base_url}}"' into the 62 generated files. Without that workaround zero of the 10 actual 5xx Resend bugs (broadcasts/send, broadcasts patch, webhooks GET) would have been observed. Suggested fix: in the probe-validation suite serializer, emit at the top of each suite: 'base_url: "{{base_url}}"' and 'headers: { Authorization: "Bearer {{auth_token}}" }', then drop the per-step Authorization header (already redundant with suite headers). Add a unit test asserting the emitted YAML contains base_url. Same likely applies to probe-methods output.
<!-- SECTION:DESCRIPTION:END -->

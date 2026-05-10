---
id: ARV-40
title: >-
  discover/capture: collision on shared {id} path-param across resources
  (broadcasts/templates/segments/topics)
status: To Do
assignee: []
created_date: '2026-05-10 11:30'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 10, finding F4, class quirk
Repro: cat apis/resend/.env.yaml → single 'id: ""' shared between 5+ resources whose path-params are unnamed (just '{id}'). After crud-broadcasts captures id=broadcast_id, smoke-segments-positive runs GET /segments/{broadcast_id} → 404.
Expected: per-resource prefixed env vars (broadcast_id, template_id, segment_id, topic_id) — same pattern already applied for email_id/webhook_id/contact_id/automation_id. Discover/capture should infer the resource scope from the path stem rather than the literal path-param name.
Actual: single 'id' is non-deterministic across runs; produces false-positive failures on follow-up suites.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-10.log:357-369
<!-- SECTION:DESCRIPTION:END -->

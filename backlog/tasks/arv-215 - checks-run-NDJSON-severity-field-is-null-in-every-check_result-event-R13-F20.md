---
id: ARV-215
title: >-
  checks run NDJSON: severity field is null in every check_result event
  (R13/F20)
status: Done
assignee: []
created_date: '2026-05-14 09:25'
updated_date: '2026-05-16 08:31'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 13, finding F20, class ux-papercut, severity LOW.

Repro:
  zond checks run --api github --report ndjson --include ... > checks.ndjson
  jq -s 'map(select(.type=="check_result"))|group_by(.severity)|map({sev:.[0].severity,n:length})' checks.ndjson
  # → [{"sev":null,"n":2118}]

Expected: each check_result event carries severity from the registry (zond checks list shows [high]/[medium]/[low] per check).

Actual: always null. Forces re-join with zond checks list to group NDJSON by severity.

Log: see feedback-13.md F20.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added severity field to check_result NDJSON events:
- src/cli/json-schemas.ts: NdjsonCheckResultEventSchema gets severity (info|low|medium|high|critical)
- src/core/checks/runner.ts: emitter pulls check.severity from registry
- docs/json-schema/ndjson-events.schema.json: published schema updated, severity required
- ajv-validating test (tests/cli/checks/ndjson-pipeline.test.ts AC #4) now passes with severity field

Now: jq -s 'map(select(.type=="check_result"))|group_by(.severity)' works without re-joining against zond checks list.
<!-- SECTION:NOTES:END -->

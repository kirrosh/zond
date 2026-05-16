---
id: ARV-67
title: >-
  prepare-fixtures --seed: synthesize nested objects from spec (examples /
  required schemas)
status: Done
assignee: []
created_date: '2026-05-11 06:50'
updated_date: '2026-05-11 07:00'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F7, class missing-feature. Repro: zond prepare-fixtures --api resend --apply --cascade --seed → miss-seed-422 contacts (POST /contacts → 422 'Expected object, received string'); miss-seed-422 automations (POST /automations → 422 'Missing steps, config, event_name'). Expected: when --seed sees required nested objects (steps:[], config:{}) in spec/JSON Schema, synthesize minimal valid body (use 'examples' from spec.json, defaults from schema). Actual: zond sends string where Resend expects object; seed-loop halts. Coverage impact: 2/13 root-resources not seeded → 12 endpoints in contacts/* and 7 in automations/* with empty FKs → 37 'no-fixtures' cells. Related: ARV-47 (already Done — reuses request body builder). Log: ~/Projects/zond-test/.fb-loop/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 generateFromSchema infers type=array when schema has items but no type
- [x] #2 generateFromSchema infers type=object when schema has properties or required but no type
- [x] #3 nested-body repro (steps[]+config{}+event_name) produces array/object/string in those slots, not all strings
- [x] #4 regression test: a typeless field with no hints still falls back to randomString (no over-reach)
<!-- AC:END -->

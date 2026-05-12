---
id: ARV-156
title: >-
  checks run ndjson: 'check' field on finding events nested under
  .finding.check, inconsistent with check_start/check_result
status: Done
assignee: []
created_date: '2026-05-12 10:02'
updated_date: '2026-05-12 10:07'
labels:
  - feedback-loop
  - api-stripe
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F10, class ux-papercut

Repro: jq -c 'select(.type=="finding") | {check, finding}' rounds/checks-coverage-03.ndjson
Expected: top-level .check field consistent across all event types — check_start, check_result, finding.
Actual: check_start and check_result have top-level .check; finding events have nested .finding.check. Forces consumers to branch by event type.

Proposed fix: emit top-level .check on finding events (copy from .finding.check). Backwards-compatible: existing consumers reading .finding.check still work.

Verify against docs/json-schema/ndjson-events.schema.json — if schema declares check only nested, that's documentation-as-designed and not a bug.

Log: $HANDOFF/rounds/checks-coverage-03.ndjson
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added top-level  to NdjsonFindingEventSchema. Updated 3 emit sites in runner.ts. Regenerated docs/json-schema/ndjson-events.schema.json. Back-compat: .finding.check still present. Commit fe21fda.
<!-- SECTION:NOTES:END -->

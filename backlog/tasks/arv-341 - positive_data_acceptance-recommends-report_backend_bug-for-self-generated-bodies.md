---
id: ARV-341
title: >-
  positive_data_acceptance recommends report_backend_bug for self-generated
  bodies
status: Done
assignee: []
created_date: '2026-07-06 10:51'
updated_date: '2026-07-06 14:06'
labels:
  - zond-bug
  - triage
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: live Stripe audit 2026-07-06. 110 POST bodies zond generated-as-valid were rejected 400; each finding carried recommended_action: report_backend_bug while its own message said "generator or spec disagrees with the implementation".

positive_data_acceptance fires ONLY on 400/422 (schema-validation reject of a body WE generated). The server is authoritative here — our body/spec was wrong, not the backend. Routing 110 spec/generator-drift cases to report_backend_bug would spam the API owner with false bug reports.

Fix: classifier check:positive_data_acceptance -> fix_spec (align the spec with what the server actually enforces), not report_backend_bug.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 check:positive_data_acceptance classifies to fix_spec
- [ ] #2 RECOMMENDED_ACTION_TABLE test updated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed earlier (see git log: 8f8846a ARV-340/341, 513ad26 ARV-342). Backlog status was stale; marking Done.
<!-- SECTION:NOTES:END -->

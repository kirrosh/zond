---
id: ARV-324
title: >-
  ARV-324: findings on operations with known-unresolved fixtures get
  recommended_action:report_backend_bug instead of a fixture-gap signal
status: Done
assignee: []
created_date: '2026-07-03 07:41'
updated_date: '2026-07-03 10:12'
labels:
  - checks
  - prepare-fixtures
  - noise
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on Stripe zond-audit run 20260703-100734. 'zond prepare-fixtures --api stripe --apply' logs 53 failed:miss-empty/failed:miss-status lines in 02-fixtures.log (financial_account, cardholder, card, active_entitlement_id, etc -- all 'no X in target API' or 'GET .../X -> 400', i.e. an empty/under-provisioned test account). 'zond checks run' independently reports 56 positive_data_acceptance MEDIUM findings on GET operations for those exact same resources, each tagged recommended_action:report_backend_bug. The two pipelines don't talk to each other, so triage has to manually join 02-fixtures.log resource names against 30-checks.ndjson operation paths to realize 56 apparent 'API bugs' collapse to one root cause (empty test account), not 56 independent backend defects. This is exactly the false-positive-looking noise the project's severity calibration (no evidence -> no high severity) is supposed to prevent -- an empty-account artifact shouldn't be recommended as report_backend_bug. Fix: when an operation's required path/query fixture is present in the fixtures-gap list (failed:miss-empty/failed:miss-status), findings on that operation should get a distinct recommended_action (e.g. fix_fixtures / known_gap:true) instead of report_backend_bug, or at minimum the finding should carry a cross-link to the fixture-gap reason.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a GET finding whose path/query fixture appears in prepare-fixtures' unresolved list is not tagged recommended_action:report_backend_bug
- [ ] #2 the finding record (or an adjacent field) makes the fixture-gap root cause discoverable without manually joining two separate log files
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed: .fixture-gaps.yaml (core/workspace/fixture-gaps.ts) + classifier unresolved_fixture branch. Live-verified mechanism on Stripe (gaps file written/read correctly, gapKey matching confirmed); no report_backend_bug finding happened to collide with a gap in that specific run, so the downgrade branch itself was verified via unit tests (recommended-action.test.ts) rather than a live collision.
<!-- SECTION:NOTES:END -->

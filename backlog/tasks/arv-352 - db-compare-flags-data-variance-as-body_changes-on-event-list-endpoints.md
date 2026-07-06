---
id: ARV-352
title: db compare flags data-variance as body_changes on event/list endpoints
status: Done
assignee: []
created_date: '2026-07-06 13:04'
updated_date: '2026-07-06 14:51'
labels:
  - zond-bug
  - db-compare
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: run 20260706-150730. zond db compare 22 23 flagged bodyChanges:1 on GetEvents — 11 added fields + 1 type_changed (request.id string->null|string). These are event-payload differences across DIFFERENT /v1/events objects returned ~2min apart, not a schema change on a stable resource. hasRegressions:false, but the entry reads like real contract drift. Regression of ARV-339 (my field-level compare).

PHILOSOPHY CONSTRAINT (litmus): do NOT add a suppression heuristic that "guesses this is data-variance" (that is the anti-FP gate ARV-337 removed). Litmus-correct: deterministic diff-MODE for collection/log endpoints — diff schema-of-union (structural) instead of per-element add/type_change — OR emit the raw diff and let the agent judge (triage already correctly called it data-variance). Scope/algorithm fix, not suppression.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 collection/log endpoints diffed structurally (schema-of-union), not per-element
- [ ] #2 no FP-suppression heuristic added
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
db-analysis.ts: BodyFieldChange gains deterministic scope (element = path crosses [], container = envelope). No suppression (litmus/ARV-337): nothing dropped or down-ranked — agent judges via scope+endpoint. summary adds bodyChangesContainer/Element split. Skill zond-triage.md documents scope. AC#1 (structural schema-of-union, not per-element) + AC#2 (no FP heuristic) met.
<!-- SECTION:NOTES:END -->

---
id: ARV-345
title: negative_data_rejection false-positives on GET-body / unknown-query mutations
status: To Do
assignee: []
created_date: '2026-07-06 10:52'
updated_date: '2026-07-06 11:07'
labels:
  - zond-bug
  - anti-fp
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: live Stripe audit 2026-07-06. 10 of 14 negative_data_rejection findings were GET ops flagged "server accepted an invalid body (200)". GET has no request-body semantics; Stripe ignoring an unknown query param / body and returning 200 is documented, expected leniency — not a validation gap.

SCOPE fix (deterministic, like ARV-340): negative_data_rejection should not evaluate body-mutation cases on GET/HEAD/DELETE — the runner already skips building negative_data bodies for GET (buildNegativeData returns null for GET), so the leak is via the param-axis coverage (buildParamCoverageCases) tagging unknown-query mutations as negative_data. Narrow what counts as a rejectable "invalid" for query-param mutations, or scope the check off GET-body entirely.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 negative_data_rejection does not emit body-invalid findings for GET/HEAD ops
- [ ] #2 no suppression/down-rank layer added — fix is in case-generation scope only
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CONSTRAINT (src/CLAUDE.md litmus): this is a SCOPE fix, NOT a suppression task. Do NOT add an anti-FP suppress/down-rank gate on emitted findings — that rebuilds the layer ARV-337 removed. Only two allowed forms: (a) deterministic case-generation scope so the check never emits the case, or (b) emit raw evidence and leave the FP call to the agent in triage (which already worked this run). The word "false-positive" in the title = the symptom, not a mandate to add FP-detection to zond.
<!-- SECTION:NOTES:END -->

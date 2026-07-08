---
id: ARV-345
title: negative_data_rejection false-positives on GET-body / unknown-query mutations
status: Done
assignee: []
created_date: '2026-07-06 10:52'
updated_date: '2026-07-06 14:25'
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
Done (6a6bd16). negative_data_rejection.run(): skip body-mutation cases on GET/HEAD/DELETE (no body semantics) and wrong-type query on GET (documented leniency); drop-required-query stays MEDIUM. Tests updated.
<!-- SECTION:NOTES:END -->

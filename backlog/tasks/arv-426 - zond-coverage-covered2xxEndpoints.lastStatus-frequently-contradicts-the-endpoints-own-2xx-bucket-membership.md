---
id: ARV-426
title: >-
  zond coverage: covered2xxEndpoints[].lastStatus frequently contradicts the
  endpoint's own 2xx-bucket membership
status: Done
assignee: []
created_date: '2026-07-10 13:52'
updated_date: '2026-07-10 14:29'
labels:
  - m-28
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sentry run#4 (m-28). 'zond coverage --api sentry --scope test --json' places an endpoint in covered2xxEndpoints (the bucket that backs pass_coverage, i.e. the tool's own honest-2xx number) while that SAME entry's lastStatus field shows a non-2xx status, up to 404. Measured: 42 of 51 entries (82%) in the final run's covered2xxEndpoints bucket have lastStatus outside 200-299. Reproduced identically on TWO independent single runs (run-id 29 and run-id 31 individually, not just the session union) for the same endpoint (GET /api/0/organizations/{organization_id_or_slug}/detectors/, lastStatus 404 in both). Manually confirmed via 'zond request GET /api/0/organizations/pe-koshelev-kirill/detectors/' that this endpoint DOES currently return 200 with the correct org slug. Likely mechanism: a single run/suite executes both a positive (valid input, 2xx) and a negative (malformed input, 4xx) case against the same endpoint+method; the 2xx-bucket membership correctly reflects 'was 2xx EVER observed', but lastStatus is overwritten by whichever case executed chronologically last (often the negative/mutated one), independent of which request actually earned the 2xx credit. Impact: this is exactly the metric the warm-up-target workflow is built around ('measure the lift via honest-2xx') — a user auditing the JSON output for 'is this endpoint healthy right now' gets an actively misleading per-endpoint signal sitting right next to the aggregate number they're supposed to trust. Fix: either (a) rename/clarify the field (e.g. bestStatus vs lastStatus, or lastPositiveStatus vs lastObservedStatus) so the two don't read as contradictory, or (b) have lastStatus reflect the status of whichever request specifically satisfied 2xx-bucket membership rather than pure chronological-last. Evidence: zond-runs/sentry-run4-20260710/raw/91-coverage-final.json.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed: added passStatus to coverage RowBucket — the 2xx status that earned covered2xx membership — so the JSON no longer shows a contradictory 4xx lastStatus next to a covered2xx row. lastStatus kept (chronological) + documented. Unit test covers the positive-then-negative case. JSON-only field; text output unchanged.
<!-- SECTION:NOTES:END -->

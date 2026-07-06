---
id: ARV-344
title: >-
  checks runner fires requests against unresolved path-param placeholders
  (account=x)
status: Done
assignee: []
created_date: '2026-07-06 10:52'
updated_date: '2026-07-06 14:25'
labels:
  - zond-bug
  - checks
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: live Stripe audit 2026-07-06. POST /v1/accounts/{account}/persons fired against literal .../accounts/x/persons (unresolved placeholder), producing a network_error finding (status 0). 68 path-params unresolved this run — sending garbage wastes rate-limit budget and manufactures noise findings.

SCOPE fix (deterministic): an op with an unresolved REQUIRED path param should skip and bucket the reason into skipped_outcomes (a fixture gap), not dispatch a request with a literal placeholder. Keep the intentional synthetic-404 path (ARV-141) where it applies — only guard the REQUIRED-and-unresolved case.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 op with unresolved REQUIRED path param skips instead of firing a placeholder request
- [ ] #2 skip reason surfaced in skipped_outcomes (fixture gap), not a network_error finding
- [ ] #3 ARV-141 synthetic-404 path preserved for non-required / intentionally-synthetic cases
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done (6a6bd16). checks/runner.ts: hasUnresolvedRequiredPathParam() gates POST/PUT/PATCH — unresolved required path param -> skip + fixture-gap bucket, not a live request against synthetic '/x/' parent. GET/HEAD/DELETE keep ARV-141 synthetic-404. Unit-tested.
<!-- SECTION:NOTES:END -->

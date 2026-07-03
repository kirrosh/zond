---
id: ARV-319
title: >-
  ARV-319: checks run crashes (r.path) on list-only CRUD group — my own ARV-314
  regression
status: Done
assignee: []
created_date: '2026-07-02 16:09'
updated_date: '2026-07-02 16:09'
labels:
  - crash
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on the 2026-07-02 18:41 live Stripe re-run (report-zond B1/B2), IMMEDIATELY after I shipped ARV-314. Root cause: the ARV-314 check_result-emission code I added ran 'group.create ?? group.read!' on EVERY pass/fail outcome in the CRUD-stateful loop. CrudGroup.create/list/read/update/delete are ALL optional (generator/types.ts) — augmentWithListOnlyGroups (runner.ts) legitimately produces groups with ONLY .list set (a GET-list endpoint whose owning resource has no POST create and no GET-by-id, common on wide specs like Stripe: /v1/balance/history, /v1/country_specs, etc.). The pre-existing 'group.create ?? group.read!' at the fail-branch had the same latent bug but only fired on FAIL outcomes — my code ran on every PASS too, so it hit first and crashed mid-stream (RC=2), truncating the stateful ndjson report (94/262 check_result, 0 findings recovered — real data loss, worse than the bug it was fixing). Fixed: representativeOp(g) helper (create>list>read>update>delete fallback chain, undefined-safe) used in both the ARV-314 event and the ARV-310 fail-finding attribution; the latter falls back to a synthetic {path: group.basePath, method: 'UNKNOWN'} operation if even representativeOp is undefined, so the crash surface is closed for good, not just patched at today's call site.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 runChecks does not throw on a CrudGroup with only .list set
- [ ] #2 check_result / finding events on such a group carry a sane operation (list op, or synthetic fallback)
- [ ] #3 regression test reproduces the exact live crash end-to-end via runChecks (not just a unit test on the check)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed + verified: reverted the fix locally, re-ran the new regression test, got the byte-identical crash (TypeError: undefined is not an object (evaluating 'r.path') at runner.ts:1194) confirming exact reproduction of the live Stripe crash; restored fix, test green. Full suite 2490/0.
<!-- SECTION:NOTES:END -->

---
id: ARV-351
title: checks/check-spec emit severity inconsistently (check_result vs finding)
status: Done
assignee: []
created_date: '2026-07-06 13:04'
updated_date: '2026-07-06 14:25'
labels:
  - zond-bug
  - checks
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: run 20260706-150730. The SAME open_cors_on_sensitive case is stamped severity:"high" on its check_result record and severity:"low" on its finding record (586 each) — the demotion hit one record type, not the other. check spec issues also carry severity:info|low.

PHILOSOPHY: per ARV-346 the severity FIELD stays (deterministic CI-gate default, load-bearing for high_or_critical + SARIF) — this is NOT about dropping it. Bug is the INCONSISTENCY: one case must emit ONE severity value across record types. Deterministic consistency fix. Pairs with ARV-346 (docs reframe).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a given case emits a single consistent severity across check_result and finding records
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done (6a6bd16). runner.ts: all 3 check_result emissions now use (outcome.kind==='fail' ? outcome.severity : undefined) ?? check.severity — matches the finding. open_cors high/low split fixed. Integration test in runner-noise-fixes.test.ts.
<!-- SECTION:NOTES:END -->

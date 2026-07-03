---
id: ARV-322
title: >-
  ARV-322: checks run --report ndjson summary undercounts findings by 1, drops
  the only non-low severity
status: Done
assignee: []
created_date: '2026-07-03 07:41'
updated_date: '2026-07-03 16:05'
labels:
  - checks
  - ndjson
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on Stripe zond-audit run 20260703-094334 (raw/30-checks.ndjson). Stream contains 262 finding records: 261 severity:low (open_cors_on_sensitive) + 1 severity:medium (content_type_conformance, GET /v1/quotes/{quote}/pdf). The trailing summary record reports findings:261 and by_severity:{medium:0,low:261,...} -- the medium finding is silently dropped from the aggregate even though it appears verbatim earlier in the same ndjson file with a timestamp (06:50:58) preceding the summary's (06:52:01), ruling out a late/out-of-order emission race. Repro: zond checks run <suite> --report ndjson against a spec with a mixed-severity finding set, then diff count(type==finding) vs summary.findings / summary.by_severity. Fix: summary aggregation must be computed from the same finding stream it reports on (or built incrementally as each finding is emitted), not from a separate/stale counter.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 summary.findings equals the count of type:finding records in the same ndjson stream
- [x] #2 summary.by_severity totals match the severity distribution of the finding records
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed via summary.suppressed accounting: guard-removed findings (already streamed) now count into summary.suppressed, so stream reconciles as findings+suppressed==count(type:finding). by_severity tallies non-suppressed only (consistent with ARV-283). Test: tests/cli/checks/ndjson-summary-reconciliation.test.ts
<!-- SECTION:NOTES:END -->

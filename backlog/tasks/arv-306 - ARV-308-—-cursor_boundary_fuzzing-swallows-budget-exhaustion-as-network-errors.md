---
id: ARV-306
title: >-
  ARV-308 — cursor_boundary_fuzzing swallows budget exhaustion as 'network
  errors'
status: Done
assignee: []
created_date: '2026-05-19 06:00'
updated_date: '2026-07-02 14:05'
labels:
  - bug
  - zond-side
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on the second Stripe live scan (zond-scans/reports/stripe/20260518T163019Z). cursor_boundary_fuzzing reported 103× skip with reason 'no mutations dispatched (network errors on every probe)' on all paged list endpoints. Manual repro of GET /v1/billing/alerts?ending_before=12345 immediately returned 500 (backend bug, unchanged from the May 17 scan that DID catch it). The check did not surface it because of: 1. its bare `catch {}` around `h.send()` swallowing the MAX_REQUESTS_SKIP_REASON sentinel that `makeHarness.send` throws when --max-requests budget is gone. 2. The earlier scan ran without --budget so the budget never tripped, the check fuzzed the wire, and the 500 came out as a HIGH finding.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 cursor_boundary_fuzzing emits skip with reason='max-requests-cap-reached' when budget exhaustion stops it, not 'no mutations dispatched (network errors on every probe)'
- [ ] #2 real per-request network errors (ECONNRESET etc.) still let the check try the remaining vectors and only collapse to the network-errors skip when ALL probes died on the wire
- [ ] #3 regression test covers both error classes (sentinel vs real network)
<!-- AC:END -->

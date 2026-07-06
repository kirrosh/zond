---
id: ARV-349
title: prepare-fixtures neither fills nor flags unresolvable suite vars
status: Done
assignee: []
created_date: '2026-07-06 13:03'
updated_date: '2026-07-06 13:44'
labels:
  - zond-bug
  - fixtures
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: run 20260706-150730. zond run apis/stripe/tests warns "Undefined variables: {{bank_code}}, {{branch_code}}, {{postal_code}}, {{tax_id}}, {{trace_id}} (30 refs across 6 suites)". prepare-fixtures neither fills nor flags these; suites run with unresolved placeholders and produce noisy 400/404s.

LITMUS/PHILOSOPHY: prepare-fixtures is deterministic single-pass (ARV-336 removed the autonomous seed engine). Correct fix is to REPORT the gap (list vars it cannot resolve), NOT auto-invent values. Deterministic gap-report -> belongs in zond; agent/user supplies the values.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 prepare-fixtures reports vars it cannot resolve (does not silently skip)
- [ ] #2 no auto-invention of values (stays single-pass deterministic)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done. prepare-fixtures now scans generated suites and reports two gap buckets (report-only, no invention): undefinedVars = suite {{vars}} with no producer (preflightCheckVars). New core/workspace/fixture-gap-report.ts + tests; wired into discoverCommand JSON summary.fixtureGaps + text warnings. AC#1 report ✓ AC#2 no auto-invention ✓.
<!-- SECTION:NOTES:END -->

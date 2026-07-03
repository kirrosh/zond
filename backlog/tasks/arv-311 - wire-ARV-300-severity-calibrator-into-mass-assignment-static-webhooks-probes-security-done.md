---
id: ARV-311
title: >-
  wire ARV-300 severity calibrator into mass-assignment/static/webhooks probes
  (security done)
status: Done
assignee: []
created_date: '2026-07-02 14:07'
updated_date: '2026-07-03 16:29'
labels:
  - calibration
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ARV-300 landed the reusable adapter (core/severity/probe-adapter.ts: calibrateProbeSeverity, sentinel passthrough) and wired the security probe (calibrateSecurityVerdicts in cli/commands/probe/security.ts + exported rollupSecuritySeverity). Remaining: load severityConfig in probe/mass-assignment.ts, probe/static.ts, probe/webhooks.ts and calibrate their verdicts the same way, recomputing each family's rollup. mass-assignment has its own Severity enum with inconclusive-baseline/-5xx sentinels — adapter already treats unknown strings as passthrough.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 mass-assignment probe findings pass through calibrateProbeSeverity
- [x] #2 static + webhooks probe findings pass through calibrateProbeSeverity
- [x] #3 each family recomputes its verdict rollup after calibration
- [x] #4 sentinel severities round-trip untouched (regression test per family)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
mass-assignment + webhooks now load severityConfig and calibrate via calibrateProbeSeverity (ARV-300 adapter). mass-assignment: per-verdict rollup severity calibrated in place (finaliseSeverity is the rollup); webhooks: per-finding by kind, then severityCount/exit-code recompute. static is a generator with no severity output — AC#2's 'static' is N/A (documented in commit). Sentinel round-trip regression: tests/core/probe/probe-severity-calibration-families.test.ts (4 tests).
<!-- SECTION:NOTES:END -->

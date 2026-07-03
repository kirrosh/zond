---
id: ARV-311
title: >-
  wire ARV-300 severity calibrator into mass-assignment/static/webhooks probes
  (security done)
status: To Do
assignee: []
created_date: '2026-07-02 14:07'
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
- [ ] #1 mass-assignment probe findings pass through calibrateProbeSeverity
- [ ] #2 static + webhooks probe findings pass through calibrateProbeSeverity
- [ ] #3 each family recomputes its verdict rollup after calibration
- [ ] #4 sentinel severities round-trip untouched (regression test per family)
<!-- AC:END -->

---
id: ARV-356
title: >-
  audit workflow: probe --emit-tests emitted without --live in live mode — lost
  all probe coverage
status: Done
assignee: []
created_date: '2026-07-06 15:40'
labels:
  - workflow
  - zond-bug
  - probe
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: run 20260706-175930 (Stripe live). zond-audit.js finish-stage emitted 'zond probe mass-assignment/security ... --emit-tests' WITHOUT --live in live mode → both exit-2 (ARV-348 gate: --emit-tests requires --live). Result: zero SSRF/CRLF/open-redirect/mass-assignment coverage this run, and downstream 'zond run <probes dir>' silently no-op'd on empty dirs. Root cause is the WORKFLOW command (not the CLI, not the zond.md skill which already teaches --live --emit-tests). Fix: workflow now uses '--live --emit-tests <dir>' in live mode and plain '--dry-run' (digest/verdicts only, no scaffolds) in safe mode.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed zond-audit.js:172-173 — live→'--live --emit-tests', safe→'--dry-run' (emit-tests needs --live per ARV-348, impossible in dry-run). Not exercised this run (stale workflow snapshot); validate on next audit.
<!-- SECTION:NOTES:END -->

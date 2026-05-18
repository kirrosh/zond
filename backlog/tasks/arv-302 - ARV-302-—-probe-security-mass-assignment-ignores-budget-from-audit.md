---
id: ARV-302
title: ARV-302 — probe security/mass-assignment ignores --budget from audit
status: To Do
assignee: []
created_date: '2026-05-18 15:26'
labels:
  - bug
  - zond-side
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bug: `zond audit --with-security --with-mass-assignment --budget standard` does NOT propagate --budget to the probe stages. `zond run` does (max-requests cap), but the probe sub-commands themselves have no request cap, so the probe stages can run unbounded (3667 mass-assignment-probes × 632 endpoints on Stripe — silently chewing minutes with no heartbeat). Found 2026-05-18 on live Stripe scan.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 audit propagates --budget tier to probe stages (or audit applies a derived --max-requests / --max-per-endpoint cap)
- [ ] #2 probe security and probe mass-assignment expose --budget (or --max-requests) and respect it standalone
- [ ] #3 audit prints a heartbeat (per-probe progress) on stderr so a long probe stage isn't silent
<!-- AC:END -->

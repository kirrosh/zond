---
id: ARV-303
title: ARV-303 — zond coverage envelope/exit code contract violation
status: Done
assignee: []
created_date: '2026-05-18 15:26'
updated_date: '2026-07-02 11:35'
labels:
  - bug
  - zond-side
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bug: `zond coverage --api ... --union session` returns envelope `{ok: true, ...}` on stdout BUT exits with code 1 when --union session cannot resolve a session (e.g. session is closed). Envelope contract: `ok:true` ⇒ exit 0; `ok:false` ⇒ exit non-zero. Found 2026-05-18 on live Stripe scan.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 if --union session fails to resolve, envelope ok=false, errors[] carries the resolution failure, exit code non-zero
- [ ] #2 if envelope ok=true, exit code is 0
- [ ] #3 regression test covers the contract on the failure path
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Corroborated again 2026-07-02 on live GitHub authed scan (zond-audit workflow): 'zond coverage --api github --union session --json' exits 1 while envelope ok:true (covered 552/1184, percentage 47), stderr empty — resolvable session too. Artifact: /Users/kirrotech/Projects/zond-runs/github/20260702-133655/report-zond.md (Z1), raw/70-coverage.json.
<!-- SECTION:NOTES:END -->

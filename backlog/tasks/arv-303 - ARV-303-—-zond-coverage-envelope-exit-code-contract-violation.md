---
id: ARV-303
title: ARV-303 — zond coverage envelope/exit code contract violation
status: To Do
assignee: []
created_date: '2026-05-18 15:26'
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

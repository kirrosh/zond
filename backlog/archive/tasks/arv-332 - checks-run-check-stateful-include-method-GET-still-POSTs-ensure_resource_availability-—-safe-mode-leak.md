---
id: ARV-332
title: >-
  checks run --check stateful --include method:GET still POSTs
  (ensure_resource_availability) — safe-mode leak
status: Done
assignee: []
created_date: '2026-07-03 13:19'
updated_date: '2026-07-03 15:53'
labels:
  - bug
  - safety
  - stateful
dependencies:
  - ARV-248
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`zond checks run --check stateful --include method:GET` executes a POST create-chain via the `ensure_resource_availability` invariant, creating a real resource on a live API despite the GET-only filter. Violates the safe-mode contract: user asked read-only, got a DB write.

Repro: `zond checks run --api <x> --check stateful --include method:GET` → POST /<collection> fires, resource created (create_status 200), left behind (no teardown). Observed on docgen-core v30: created external-systems `Awr7wXmy`, not cleaned up.

Discovered during live zond-scan (report-zond MF1). Related: ARV-248 (track+cleanup POST-orphans).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 method:GET (or any no-mutation scope) gates stateful create-chains: ensure_resource_availability skipped when no method:POST in scope
- [ ] #2 OR transport hard-blocks non-GET when --include method:GET is set
- [ ] #3 Any stateful-created resource is torn down (no orphan)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
FIX (src/core/checks/runner.ts ~L1050): detectCrudGroups(allOps)→detectCrudGroups(ops) — CRUD groups now built from the operationFilter-filtered op set. Under --include method:GET no group carries a create, so ensure_resource_availability/use_after_free self-skip via applies(g). AC#1 satisfied.

Test: tests/cli/checks/arv332-safe-mode-gate.test.ts — GET-only scope → 0 POST; control (no filter) → POST fires. 361 checks tests green, no regressions.

AC#3 (teardown of resources created in a FULL live run, no filter) is NOT covered here — that orphan-cleanup rides on ARV-248. This task closes the safe-mode LEAK specifically.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Safe-mode leak closed: detectCrudGroups now built from operationFilter-filtered ops, so --include method:GET no longer fires POST create-chains (ensure_resource_availability/use_after_free self-skip). Test: tests/cli/checks/arv332-safe-mode-gate.test.ts. AC#3 (teardown of resources created in a FULL live run) rides ARV-248, out of scope here.
<!-- SECTION:FINAL_SUMMARY:END -->

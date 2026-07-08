---
id: ARV-360
title: >-
  db latest-run-id resolver returns stale unrelated run → silent self-compare,
  no A==B guard
status: Done
assignee: []
created_date: '2026-07-06 18:17'
updated_date: '2026-07-06 18:43'
labels:
  - zond-bug
  - db-compare
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: run petstore/20260706-210328. After empty 'zond run' (B1 side-effect) added nothing to the DB, RUN_A=$(zond db runs --json | jq '.data.runs[0].id') and RUN_B both returned 5 — an earlier 'probe mass-assignment' run, unrelated to the intended suites. 61-run-ids.txt = 'RUN_A=5 RUN_B=5'; 'zond db compare 5 5' diffed run 5 against ITSELF → regressions:0 bodyChanges:0 unchanged:3, a meaningless green with no signal that A==B or that the id came from a different command kind. LITMUS: deterministic guard, belongs in zond. FIX: 'zond db compare' should warn/error when idA==idB (self-compare is never meaningful), and/or 'db runs' consumers should be able to filter by run_kind so a pipeline asking for 'the last suite run' doesn't silently get a probe run. Overlaps ARV-357 (the empty-run that caused the stale id).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
db.ts compare case: guard idA===idB → fail loud (exit 2, 'cannot compare run against itself'), both json+text. Verified on petstore run DB (compare 5 5 → ok:false). Prevents the fake-green self-compare when latest-run-id resolves to one stale run. The run-kind-filter half is deferred/opportunistic; the self-compare guard closes the harmful symptom.
<!-- SECTION:NOTES:END -->

---
id: ARV-380
title: >-
  zond db diagnose has no multi-run aggregation (unlike coverage's --union
  session/since/tag)
status: Done
assignee: []
created_date: '2026-07-09 08:53'
updated_date: '2026-07-09 09:54'
labels:
  - feature
  - cli
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Session: an audit session spanned 5 runs (safe smoke, CRUD, mass-assignment probe, two learn passes). To get one aggregate by_recommended_action breakdown across the whole session I had to loop:

  for id in 263 266 267 269 270; do zond db diagnose $id --json; done | <python Counter aggregation>

`zond coverage` already solved exactly this shape for its own metric (`--union session`, `--union since:<dur>`, `--union tag:<name>`, `--union runs:<id1,id2,...>`). `db diagnose` has no equivalent — it's strictly single-run.

Proposed: give `db diagnose` the same `--union` vocabulary coverage already has (`session` / `since:<dur>` / `tag:<name>` / `runs:<id1,id2,...>`), aggregating `by_recommended_action` (and ideally `by_root_cause`) counts + deduped examples across the matched runs, instead of requiring the caller to loop `db diagnose` per run-id and merge client-side.

Litmus test: aggregating counts/examples across a run-id set the caller already has (session id, time window, tag) is mechanical, no severity/FP/blame judgment — belongs in zond core, and should reuse coverage's --union parsing rather than reinventing it.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
db diagnose --union {session|since:<dur>|tag:<name>|runs:<ids>} reuses coverage's parseUnion; aggregates by_recommended_action + summary across the run set. --api scopes since:/tag:. Verified docgen: runs:1,2,3 → 465=155×3.
<!-- SECTION:NOTES:END -->

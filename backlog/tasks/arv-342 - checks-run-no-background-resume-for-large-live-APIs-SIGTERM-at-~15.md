---
id: ARV-342
title: 'checks run: no background/resume for large live APIs (SIGTERM at ~15%)'
status: To Do
assignee: []
created_date: '2026-07-06 10:52'
updated_date: '2026-07-06 11:14'
labels:
  - zond-missing-feature
  - checks
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: live Stripe audit 2026-07-06. zond checks run --phase coverage on 587 ops @ rate-limit 30 cannot finish in a foreground window (est. ~13min > 600s bash cap). The audit reached only 87/587 ops (15%) before SIGTERM; even backgrounded it was interrupted. Needs: op-count-aware default, a --resume/checkpoint, or a documented detached-run path so wide specs complete.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CONFIRMED BLOCKER of "max breadth/depth" goal. Re-run 20260706-135748 proved the workflow-level "run in background" band-aid does NOT hold: the 587-op sweep was SIGTERM-killed at 80/587 (~15%) after a ~69s window (well under the 120s bash cap) — the bg process is reaped when the agent turn ends. There is no window long enough for a single full sweep, and no checkpoint, so ALL downstream artifacts (61/62/63 yaml, 70-coverage, 90-status-dist) are lost every time.

MINIMAL DETERMINISTIC FIX (passes src/CLAUDE.md litmus — pure scoping, no judgment): add an operation-window to runChecks + CLI, e.g. --max-ops N + --skip-ops M (or --offset/--limit), slicing the sorted `ops` array. The audit workflow then loops bounded windows that each finish in-budget, appending to one NDJSON, until skip>=total. Gives full 587-op breadth + partial artifacts survive each window. NOT adaptive/"smart" pacing — a fixed, replayable op-list slice.
<!-- SECTION:NOTES:END -->

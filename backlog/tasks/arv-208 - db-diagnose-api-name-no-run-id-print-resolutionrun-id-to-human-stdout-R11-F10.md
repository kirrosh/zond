---
id: ARV-208
title: >-
  db diagnose --api <name> (no run-id): print resolution+run-id to human stdout
  (R11/F10)
status: Done
assignee: []
created_date: '2026-05-14 08:22'
updated_date: '2026-05-16 11:20'
labels:
  - feedback-loop
  - api-github
  - m-21
  - polish-m-22
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 11, finding F10, class ux-papercut, severity LOW.

Repro:
  zond db diagnose --api github
  # → diagnoses 'latest-failing' run silently; user has no idea which run was picked
  zond db diagnose --api github --json   # → correctly carries resolution:'latest-failing', run_id:51

Expected: human-readable line on stdout like 'Triaged smoke-run-51 (47 steps, 10 fix_env, 0 ...)' so the user doesn't have to add --json just to see which run was selected.

Actual: silent in non-JSON mode. zond-triage skill prompts assume the user/agent knows which run-id was triaged.

Log: see feedback-11.md F10.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done 2026-05-16 (polish-m-22 batch-1): db diagnose human stdout embeds {resolution, run_id} in the printed JSON detail (db.ts diagnose case). Stderr cue kept for interactive runs.
<!-- SECTION:NOTES:END -->

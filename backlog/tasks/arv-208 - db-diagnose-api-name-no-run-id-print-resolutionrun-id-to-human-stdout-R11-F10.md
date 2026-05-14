---
id: ARV-208
title: >-
  db diagnose --api <name> (no run-id): print resolution+run-id to human stdout
  (R11/F10)
status: To Do
assignee: []
created_date: '2026-05-14 08:22'
labels:
  - feedback-loop
  - api-github
  - m-21
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

---
id: ARV-205
title: >-
  prepare-fixtures --json envelope: command field says 'bootstrap', should be
  'prepare-fixtures' (R10/F6)
status: Done
assignee: []
created_date: '2026-05-14 08:12'
updated_date: '2026-05-14 10:05'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 10, finding F6, class quirk, severity LOW.

Repro:
  zond prepare-fixtures --api github --apply --cascade --seed --json
  # → {ok:false, command:'bootstrap', errors:[{code:'unknown_error', message:'...'}]}

Expected: command field should reflect the actual command (prepare-fixtures), not 'bootstrap'.

Log: see feedback-10.md F6.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
round-14 F19-REOPEN: fixed. R13 patch covered only the bootstrap (cascade) delegation path; prepare-fixtures --apply alone (no --cascade) routes through discoverCommand which still hardcoded jsonOk/jsonError('discover'). Added commandName option to DiscoverOptions and pass 'prepare-fixtures' from prepare-fixtures.ts in both branches. Verified: zond prepare-fixtures --api gh-verify --apply --json now emits command:'prepare-fixtures'.
<!-- SECTION:NOTES:END -->

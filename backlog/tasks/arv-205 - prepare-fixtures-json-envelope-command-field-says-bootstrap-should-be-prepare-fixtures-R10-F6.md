---
id: ARV-205
title: >-
  prepare-fixtures --json envelope: command field says 'bootstrap', should be
  'prepare-fixtures' (R10/F6)
status: Done
assignee: []
created_date: '2026-05-14 08:12'
updated_date: '2026-05-14 09:34'
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
round-13 F19: closed. bootstrap.ts now reads commandName from options (defaults to 'bootstrap' for direct invocations), and prepare-fixtures.ts passes commandName='prepare-fixtures' when delegating via --cascade/--seed. The JSON envelope now correctly reads command='prepare-fixtures' instead of 'bootstrap'.
<!-- SECTION:NOTES:END -->

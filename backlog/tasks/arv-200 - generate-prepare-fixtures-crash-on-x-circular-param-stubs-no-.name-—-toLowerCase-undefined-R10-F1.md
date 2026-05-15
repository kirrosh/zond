---
id: ARV-200
title: >-
  generate/prepare-fixtures crash on x-circular param stubs (no .name) —
  toLowerCase undefined (R10/F1)
status: Done
assignee: []
created_date: '2026-05-14 08:11'
updated_date: '2026-05-14 08:26'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 10, finding F1, class definitely_bug, severity HIGH.

Repro:
  cd ~/Projects/zond-test
  zond add api github  # spec from api.github.com
  zond use github
  zond prepare-fixtures --api github
  # → Error: undefined is not an object (evaluating 'p.name.toLowerCase')
  zond generate --api github --output /tmp/x --explain
  # same crash

Expected: prepare-fixtures and generate should skip params that are pure {x-circular: true} stubs (no .name), or replace them with empty entries and log 'warn: skipped N circular param stubs'.

Actual: bare TypeError, no stack, no envelope on plain runs. --json wraps under errors:[{code: unknown_error}]. github spec has 2838 such stubs across 1119 endpoints.

Root cause: dereferencer marks circular param positions with { x-circular: true } (no name field). Downstream param normalization (filter/map with p.name.toLowerCase()) crashes.

Impact: BLOCKER — github spec completely unusable for the main pipeline (generate, prepare-fixtures, probes that walk resources). Only check spec and zond request (ad-hoc) work.

Log: $HANDOFF/rounds/raw-10.log (empty — zond writes to stdout); see feedback-10.md for full trace context.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
round-12 F13: duplicate of F7 (coverage crash). Already closed by ARV-200 fix. Tester still on old binary (mtime 1778744856) so cannot verify yet — next round should show coverage working.
<!-- SECTION:NOTES:END -->

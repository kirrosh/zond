---
id: ARV-155
title: 'session start: add --force / auto-resume when a session is already active'
status: Done
assignee: []
created_date: '2026-05-12 10:02'
updated_date: '2026-05-12 10:05'
labels:
  - feedback-loop
  - api-stripe
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F8, class ux-papercut

Repro: zond session start --label 'round-03 stripe explore-checks'
Expected: --force flag to replace, or auto-resume with warning, or accept --label without 'start' command (chain after end).
Actual: hard error 'Session already active (0046a960-...). Run zond session end first.' — user must manually run zond session end first.

Effect: in ralph-loop iterations this costs an extra turn per session boundary.

Log: $HANDOFF/rounds/raw-03.log:1
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added --force flag to session start. With --force: clears existing session and writes new one. Without --force: behavior unchanged, error hint mentions --force. Commit 5358275.
<!-- SECTION:NOTES:END -->

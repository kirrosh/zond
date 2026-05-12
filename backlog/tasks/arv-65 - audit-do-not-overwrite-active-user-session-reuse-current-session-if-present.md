---
id: ARV-65
title: 'audit: do not overwrite active user session (reuse current-session if present)'
status: To Do
assignee: []
created_date: '2026-05-11 06:50'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F5, class definitely_bug. Repro: zond session start --label round-01; zond audit --api resend; zond session end → 'no current session'. Expected: audit either reuses current session_id when present, or runs under --no-session-overwrite. Actual: audit calls its own session start (gets new id) and session end, silently killing user's outer session via global .zond/current-session. Workflow 'start session → audit → coverage in one session' is broken. Log: ~/Projects/zond-test/.fb-loop/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->

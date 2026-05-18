---
id: ARV-65
title: 'audit: do not overwrite active user session (reuse current-session if present)'
status: Done
assignee: []
created_date: '2026-05-11 06:50'
updated_date: '2026-05-16 08:43'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in src/cli/commands/audit.ts buildStages(): readCurrentSession() before pushing session lifecycle stages. When .zond/current-session exists:
- session-start stage gets skip-with-reason 'reusing active session <id>'
- session-end stage gets the same skip — critical half: prevents audit from clearing user's session on exit
- run stages (run-tests/run-probes) inherit the outer session_id naturally (zond run reads current-session at execution time)

Test: tests/cli/audit.test.ts adds 'ARV-65: when .zond/current-session exists, session-start + session-end stages are SKIPPED'.

Verified manually in /tmp/zond237: zond session start --label outer → zond audit --dry-run shows 'session start (reused)' / 'session end (reused — kept active)'.
<!-- SECTION:NOTES:END -->

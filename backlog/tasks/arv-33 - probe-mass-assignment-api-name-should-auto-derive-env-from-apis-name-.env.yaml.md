---
id: ARV-33
title: >-
  probe mass-assignment: --api <name> should auto-derive --env from
  apis/<name>/.env.yaml
status: Done
assignee: []
created_date: '2026-05-10 11:20'
updated_date: '2026-05-10 11:26'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 09, finding F1, class definitely_bug
Repro: zond probe mass-assignment --api resend → 'Missing --env <file> (or pass --api <name> to derive it from apis/<name>/.env.yaml)'. Self-contradictory — the error suggests the exact form that's failing.
Expected: --api auto-derives --env (apis/<name>/.env.yaml) just like zond probe security and zond probe static do; same pattern as ARV-29 / TASK-17 / TASK-20. Help text already documents this behaviour.
Actual: probe mass-assignment options handler is missing the 'if --api && !--env → derive env-path' branch, so users who follow the help end up with a contradictory error. zond audit pipes through with explicit --env, so the bug only shows up in direct invocations.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-09.log:83 (failing call), :292 (works with explicit --env), :303 (no --api correctly requires --env), :135 (help)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond probe mass-assignment --api <name> auto-derives --env from apis/<name>/.env.yaml when commander routes --api to the global option (no current-api set)
- [x] #2 Same fix applied to zond probe security so both umbrella subcommands use the consistent --api → ZOND_API_GLOBAL → readCurrentApi() fallback chain (parity with prepare-fixtures, audit, run, ARV-29)
- [x] #3 Regression test exercises the global-flag + per-subcommand fallback for at least probe mass-assignment
- [x] #4 bun run check passes
<!-- AC:END -->

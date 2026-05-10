---
id: ARV-29
title: zond audit --api falls back to ZOND_API / current-api (regression fix)
status: Done
assignee: []
created_date: '2026-05-10 08:38'
updated_date: '2026-05-10 08:39'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 07, finding F1, class definitely_bug
Repro: zond audit --api resend / --api=resend / zond --api resend audit / zond audit (current=resend) — все падают с 'required option --api <name> not specified'
Expected: same fallback chain as prepare-fixtures (TASK-20) and checks run (TASK-17): explicit --api > ZOND_API env > current-api file
Actual: src/cli/commands/audit.ts:376 still uses requiredOption() — entire audit macro is unreachable
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-07.log (block 'B.repro: audit — все варианты передачи --api')
<!-- SECTION:DESCRIPTION:END -->

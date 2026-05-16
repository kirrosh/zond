---
id: ARV-43
title: >-
  session list: show id/label/started_at/run_count/status so coverage
  --session-id is discoverable
status: Done
assignee: []
created_date: '2026-05-10 11:36'
updated_date: '2026-05-10 11:39'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 11, finding F3, class missing-feature
Repro: zond session list → 'unknown command list'. zond session --help only lists start/end/status/help.
Expected: 'zond session list [--limit N]' prints id, label, started_at, run_count, status (open/closed). Symmetric with start/end. Without it, coverage --union session --session-id <id> requires sqlite3 spelunking.
Actual: workflow 'open report for last week's audit' requires manual SQL.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-11.log:181-183, :206-218
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond session list prints sessions in plain text: id, started_at, finished_at, run_count, total/passed/failed
- [x] #2 Supports --limit (default 20) and --json for envelope output
- [x] #3 Reuses listSessions() / countSessions() from src/db/queries/sessions.ts (no schema changes)
- [x] #4 Help text on 'zond session' lists 'list' alongside start/end/status
- [x] #5 Regression test covers list output (text + json)
- [x] #6 bun run check passes
<!-- AC:END -->

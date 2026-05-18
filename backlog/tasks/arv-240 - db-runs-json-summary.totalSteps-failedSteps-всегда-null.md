---
id: ARV-240
title: 'db runs --json: summary.totalSteps/failedSteps всегда null'
status: Done
assignee: []
created_date: '2026-05-14 11:16'
updated_date: '2026-05-16 10:55'
labels:
  - feedback-loop
  - api-github
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F13, class quirk
Repro: zond db runs --limit 5 --json | jq '.data.runs[] | {id, total: .summary.totalSteps, failed: .summary.failedSteps}'
Expected: totals для quick triage без захода в db diagnose
Actual: total: null, failed: null для всех run'ов, хотя сами run'ы успешно завершились (passed/failed reflected в db diagnose).
Log: ~/Projects/zond-test/.fb-loop/rounds/raw-03.log
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
round-03/F13 — envelope shape is correct; runs[].total/passed/failed are present at top level, not inside .summary. Tester used incorrect jq path. Could add a jq cheat-line to skill zond.md:539 — see follow-up below.

NOTE: keep as backlog, low priority. Не блокер.

Closed in triage 2026-05-16: envelope shape is correct — total/passed/failed live at runs[].* (top-level), not nested under summary. Tester used wrong jq path. Optional follow-up (skill jq cheat-line) tracked separately if needed.
<!-- SECTION:NOTES:END -->

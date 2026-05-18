---
id: ARV-230
title: 'checks run --report ndjson: SIGTERM leaves truncated JSON line (R17/F35)'
status: Done
assignee: []
created_date: '2026-05-14 10:12'
updated_date: '2026-05-18 11:53'
labels:
  - feedback-loop
  - api-github
  - m-21
  - polish-m-22
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 17, finding F35, class quirk, severity LOW.

Repro: kill -SIGTERM running 'zond checks run --report ndjson --output ...' → exit code 144; .ndjson file truncated mid-line; jq -s fails until last line is stripped with sed '$d'.

Expected: SIGTERM handler flushes last event and closes the stream cleanly.

Log: see feedback-17.md F35.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/cli/commands/checks.ts: добавлен SIGTERM/SIGINT handler для NDJSON режима (file и stdout). При прерывании flush'ит trailing newline если последний event не был полностью записан, закрывает fd, exit 128+signo. Handler снимается после нормального завершения runChecks или в catch. Note: pre-existing failure tests/cli/checks/ndjson-pipeline.test.ts AC #4 (summary.suppressed не в schema) — не связано с этим fix, нужен отдельный backlog item.
<!-- SECTION:NOTES:END -->

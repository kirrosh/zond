---
id: TASK-241
title: 'report-out: статус-сообщение пишется в stdout вместо stderr'
status: Done
assignee: []
created_date: '2026-05-08 08:37'
updated_date: '2026-05-09 09:14'
labels:
  - feedback-loop
  - api-sentry
milestone: m-14
dependencies: []
priority: high
---

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fix: in non-JSON mode, report export and report bundle now route status to stderr and emit only the artifact path on stdout. Enables out=$(zond report export <id>) and other agent-friendly piping. Tests in tests/cli/report-{export,bundle}.test.ts still green.
<!-- SECTION:NOTES:END -->

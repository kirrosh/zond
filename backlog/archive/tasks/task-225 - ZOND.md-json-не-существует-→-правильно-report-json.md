---
id: TASK-225
title: 'ZOND.md: --json не существует → правильно --report json'
status: Done
assignee: []
created_date: '2026-05-07 14:56'
updated_date: '2026-05-07 15:08'
labels:
  - feedback-loop
  - api-resend
  - docs
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F18, class definitely_bug-docs. Repro: ZOND.md (Safe Test Coverage Workflow, Phase 2): zond run <output> --safe --json -> error: unknown option --json. Правильно: --report json (или --report json --report-out file.json). Log: /tmp/zond-fb/resend/rounds/raw-04b.log
<!-- SECTION:DESCRIPTION:END -->

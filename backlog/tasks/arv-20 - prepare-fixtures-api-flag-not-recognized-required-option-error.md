---
id: ARV-20
title: 'prepare-fixtures: --api flag not recognized (required option error)'
status: Done
assignee: []
created_date: '2026-05-10 07:25'
updated_date: '2026-05-10 07:33'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F1, class definitely_bug
Repro: zond prepare-fixtures --api resend / --api=resend / zond --api resend prepare-fixtures → all fail with: error: required option '--api <name>' not specified
Expected: command runs single-pass discover and prints diff to stdout (per --help docs).
Actual: parser does not see --api as set in any form. Command is completely unusable, blocking automatic fixture seeding and all CRUD-positive coverage.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-03.log
<!-- SECTION:DESCRIPTION:END -->

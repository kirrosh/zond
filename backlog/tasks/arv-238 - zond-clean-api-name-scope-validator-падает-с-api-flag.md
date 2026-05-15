---
id: ARV-238
title: 'zond clean --api <name>: scope validator падает с --api flag'
status: Done
assignee: []
created_date: '2026-05-14 11:16'
updated_date: '2026-05-14 11:23'
labels:
  - feedback-loop
  - api-github
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F11/SD9, class likely_bug
Repro: zond clean --api github
Expected: --api <name> валидный scope (help явно: '--api <name>  Limit to a single API'); skill zond/SKILL.md:592 явно показывает 'zond clean --api <name>  # dry-run'.
Actual: 'Error: Specify a scope: --api <name>, --probes, or --all.' → exit 1. Валидатор требует один из [--probes, --all], --api интерпретируется как filter не scope.
Log: ~/Projects/zond-test/.fb-loop/rounds/raw-03.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 clean.ts action resolves --api via getApi() fallback (program-level/env/.zond-current-api)
- [x] #2 zond clean --api github does not error out, returns dry-run plan
<!-- AC:END -->

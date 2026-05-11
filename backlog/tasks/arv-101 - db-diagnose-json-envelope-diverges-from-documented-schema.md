---
id: ARV-101
title: db diagnose --json envelope diverges from documented schema
status: Done
assignee: []
created_date: '2026-05-11 08:15'
updated_date: '2026-05-11 08:32'
labels:
  - feedback-loop
  - api-sentry
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F6, class likely_bug/ux-papercut
API: sentry

Repro:
  zond db diagnose 14 --json | jq '.data | keys'
  # → ['env_issue','failures','grouped_failures','resolution','run','run_id','suggested_fixes','summary']

Expected: согласно zond/SKILL.md L443-449 и zond-base/SKILL.md L174-197 envelope должен следовать единой схеме {ok, command, data, warnings, errors, exit_code}, где payload содержит группировку по recommended_action enum (canonical TASK-294). Hand-off-агенту удобнее .data.by_recommended_action или .data.groups[].action, а не разворачивать failures[].recommended_action через jq | group_by.

Actual: ключи payload'a — failures/grouped_failures/suggested_fixes/resolution/env_issue — без явной enum-агрегации. На 21 fail возвращается 4 группы (grouped_failures, дефолтный лимит примеров на группу) — не очевидно, видно ли все 21 без --verbose.

Effect: zond-triage скилл рекомендует 'route on recommended_action enum', но текущая JSON-форма требует переразложить руками; skill-drift между документацией и реальным envelope.

Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-01.log блок '=== db diagnose ==='
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 db diagnose --json payload exposes a top-level group keyed by recommended_action enum
- [x] #2 Existing keys (failures, grouped_failures, suggested_fixes, etc.) preserved for backwards-compat
- [x] #3 Each enum bucket reports count + at least sample failure IDs
- [x] #4 Test pins the new key shape
<!-- AC:END -->

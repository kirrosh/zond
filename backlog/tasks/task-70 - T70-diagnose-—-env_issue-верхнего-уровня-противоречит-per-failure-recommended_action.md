---
id: TASK-70
title: >-
  T70: diagnose — env_issue верхнего уровня противоречит per-failure
  recommended_action
status: To Do
assignee: []
created_date: '2026-04-29 08:38'
labels:
  - bug
  - diagnose
milestone: m-3
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Когда {{auth_token}} не подставился (variable missing), diagnose отдал одновременно:
- env_issue: "All failures: some variables are not substituted" (правильно, run-level)
- per-failure recommended_action: "fix_test_logic" + hint: "Validation error — check request body fields match the schema" (неправильно — реальный fix это env)

Пользователь читает hint и идёт чинить тело, тратя время. Если есть env_issue — все recommended_action должны быть подавлены или переопределены на 'fix_env'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Если есть env_issue — все per-failure recommended_action подавляются или переопределяются на 'fix_env'
- [ ] #2 Tест: missing {{auth_token}} → env_issue, recommended_action = fix_env, не fix_test_logic
<!-- AC:END -->

---
id: TASK-294
title: 'unify recommended_action enum across Issue, SecurityFinding, FixtureMissing'
status: To Do
assignee: []
created_date: '2026-05-09 07:00'
labels:
  - json
  - agent-first
  - m-13
milestone: m-13
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас recommended_action enum (report_backend_bug | fix_auth_config | fix_test_logic | fix_network_config | fix_env) есть только в db diagnose --json. Распространить на lint-spec.Issue, probe-security.Finding, probe-mass-assignment, discover.FixtureMissing. Агент тогда умеет маршрутизировать findings без LLM-классификации. Источник: vector-3-agent-first.md §4 (#2), §5 quick win #2.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Тип RecommendedAction экспортирован одним enum
- [ ] #2 Issue / SecurityFinding / FixtureMissing содержат поле recommended_action
- [ ] #3 Snapshot-тесты подтверждают enum в --json
<!-- AC:END -->

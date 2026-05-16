---
id: ARV-138
title: >-
  manifest plodит camelCase + snake_case duplicates for the same path-param
  (issue_id + issueId)
status: Done
assignee: []
created_date: '2026-05-11 20:35'
updated_date: '2026-05-11 20:49'
labels:
  - bug
  - manifest
  - generator
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sentry round-01 fb-loop: .api-fixtures.yaml содержит ОДНОВРЕМЕННО `issue_id:` и `issueId:` как два независимых vars. Разные spec-операции используют разное написание одного и того же param — manifest-builder не нормализует. Тесты, ссылающиеся на одно написание, конфликтуют с тестами, ссылающимися на другое. doctor отдельно показывает оба как UNSET (раздувает 35 missing на sentry-spec). Источник: ~/Projects/zond-test/.fb-loop/rounds/feedback-01.md F4. Также skill-drift SD2 в zond-base.md (нет caveat про дубли).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 manifest-builder нормализует {paramName} к одной canonical форме (snake_case)
- [ ] #2 Generator при эмиссии теста использует ту же canon-функцию, что manifest
- [ ] #3 Regression test: spec с {issueId} в одной op и {issue_id} в другой → один manifest var
<!-- AC:END -->

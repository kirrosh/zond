---
id: ARV-137
title: >-
  generator emits canonical-id placeholders missing from .api-fixtures.yaml
  manifest
status: Done
assignee: []
created_date: '2026-05-11 20:35'
updated_date: '2026-05-11 20:49'
labels:
  - bug
  - generator
  - manifest
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sentry round-01 fb-loop: после `zond generate apis/sentry/spec.json` 8 suites ссылаются на `{{delete_id}}`, `{{group_id}}`, `{{monitor_id}}`, `{{project_id}}`, `{{release_id}}`, `{{saved_id}}` (+2 ещё) — 15 references total. Этих vars нет в .api-fixtures.yaml: manifest содержит канонические имена с суффиксами (`monitor_id_or_slug`, `project_id_or_slug` и т.п.) после ARV-40 disambig. Generator и manifest-builder расходятся в нормализации path-params. Контракт zond-base.md: `{{var}}` в сгенерённом тесте должен быть в manifest. Невозможно починить через .env.yaml — `not in manifest, ignored`. Связано с ARV-40 (path-param disambig). Source: ~/Projects/zond-test/.fb-loop/rounds/feedback-01.md F5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Generated suite не содержит {{var}}, отсутствующих в .api-fixtures.yaml
- [ ] #2 manifest-builder и generator используют единую canon-функцию для имён path-params
- [ ] #3 Regression test: spec с {id} в N>1 resources → manifest содержит ровно те vars, что генератор эмитит
<!-- AC:END -->

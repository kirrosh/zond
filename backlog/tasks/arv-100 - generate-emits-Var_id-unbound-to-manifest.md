---
id: ARV-100
title: 'generate emits {{Var_id}} unbound to manifest'
status: Done
assignee: []
created_date: '2026-05-11 08:15'
updated_date: '2026-05-11 08:30'
labels:
  - feedback-loop
  - api-sentry
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F5, class likely_bug
API: sentry

Repro:
  zond generate apis/sentry/spec.json --output apis/sentry/tests
  zond run apis/sentry/tests --safe --rate-limit auto --report json
  # → Warning: Undefined variables: {{Group_id}}, {{User_id}}, {{delete_id}},
  #   {{monitor_id}}, {{project_id}}, {{releas_id}}, … and 2 more
  #   (15 references across 8 suites)

Expected: либо var в .api-fixtures.yaml объявлен и заполняется, либо генератор использует {{$randomString}} / capture из setup-сьюта. Каждый {{var}} в сгенерённом тесте, которого нет в manifest, — bug либо manifest-builder'а, либо генератора (см. zond-base/SKILL.md L65-67).

Actual: эти переменные prepare-fixtures пометил skipped:not-required (not owned by discover) — manifest-builder завёл их как capture-chain, но генератор всё равно ссылается на них как на свободные {{var}}. prepare-fixtures их не заполнит, и run ругается на undefined-references. Ничейная зона.

Effect: 15 references / 8 suites — поломанные ассерты в smoke-pass'е; роняют сьюты в skipped, скрывая реальную глубину покрытия.

Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-01.log warning из zond run.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Generator emits only {{var}} names that exist in .api-fixtures.yaml manifest, or {{$randomString}}/capture refs
- [x] #2 Capitalised path-param names (e.g. Group_id) are normalised to their manifest entry (group_id)
- [x] #3 Mistyped names (releas_id, delete_id) use spec source; if no source —
- [x] #4 Test pins manifest/generator alignment for path-params
<!-- AC:END -->

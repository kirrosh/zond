---
id: ARV-124
title: 'anti-fp: migrate checks/_anti_fp.ts rules into registry'
status: To Do
assignee: []
created_date: '2026-05-11 10:14'
labels:
  - m-19
  - refactor
  - anti-fp
dependencies:
  - ARV-123
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§2.2 refactor-plan. Перенести 4 schemathesis-FP правила из src/core/checks/checks/_anti_fp.ts в core/anti-fp/rules/schemathesis/.

Правила (по существующим именам в _anti_fp.ts):
- body_negation_becomes_valid_after_serialization (#2482, #2726, #3712)
- string_type_mutation_becomes_valid (#2312, #2978)
- has_unverifiable_mutations (#2713)
- + 1 ещё (см. файл)

Каждое правило -> отдельный файл core/anti-fp/rules/schemathesis/<id>.ts с FpRule export. references[] заполняется schemathesis issue numbers. checks/negative_data_rejection и positive_data_acceptance вызывают applyAntiFp() вместо текущих guard'ов.

После миграции — checks/_anti_fp.ts удаляется.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 4 правила в core/anti-fp/rules/schemathesis/
- [ ] #2 src/core/checks/checks/_anti_fp.ts удалён
- [ ] #3 tests/core/checks/checks/negative_data_rejection.test.ts зелёные
- [ ] #4 fixture-pack из 6 schemathesis-FP regressions проходит
<!-- AC:END -->

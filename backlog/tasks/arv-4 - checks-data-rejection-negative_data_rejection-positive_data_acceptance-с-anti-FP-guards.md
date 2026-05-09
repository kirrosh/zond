---
id: ARV-4
title: >-
  checks: data-rejection (negative_data_rejection + positive_data_acceptance) с
  anti-FP guards
status: Done
assignee: []
created_date: '2026-05-09 15:46'
updated_date: '2026-05-09 16:36'
labels:
  - checks
  - m-15
  - depth
  - anti-fp
milestone: m-15
dependencies:
  - ARV-1
priority: high
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Оба check реализованы с anti-FP guards 1-в-1 со schemathesis (см. их checks.py)
- [x] #2 Регрессионный fixture-pack tests/regression/schemathesis-fps/*.json — 6 кейсов, все green
- [x] #3 Unit-тест на каждый guard отдельно (3 unit-таблицы)
- [x] #4 Документация в коде ссылается на исходные schemathesis issue номера
- [x] #5 Integration: mock с serialize-coerce (string→int на сервере) — finding NOT issued
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
- `negative_data_rejection`: API принял невалидное тело. Default expected: 400/401/403/404/422/428/5xx.
- `positive_data_acceptance`: API отверг валидное тело. Default expected: 2xx/401/403/404/409/5xx.

Anti-FP guards (КРИТИЧНО, копируем дословно из schemathesis):
- `_body_negation_becomes_valid_after_serialization`: после URL/form-encoding мутация снова валидна — skip.
- `_string_type_mutation_becomes_valid_after_serialization`: кастинг строки в нужный тип на сервере — skip.
- `_has_unverifiable_mutations`: множественные мутации на disjoint sites — skip.

Регрессионный fixture-pack: 6 кейсов из закрытых schemathesis issues #2312, #2482, #2713, #2726, #2978, #3712. Каждый раньше давал FP, после guard — не должен.
<!-- SECTION:PLAN:END -->

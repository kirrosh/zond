---
id: ARV-60
title: >-
  checks run: roll up spec-level findings (1-issue × N-ops noise → 1 summary
  line)
status: To Do
assignee: []
created_date: '2026-05-11 02:48'
updated_date: '2026-05-16 07:35'
labels:
  - checks
  - feedback-loop
  - m-16
  - depth
  - ux
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: tester rounds 18-19, depth-pass на resend.

Паттерн повторяется трижды и продолжит повторяться на любом spec'е с системным gap'ом:

| Check | Манифестация | Текущий вывод |
|---|---|---|
| status_code_conformance | resend кидает 401 на 83/83 endpoint'ах, но spec не объявляет 401 нигде | 83 finding'а "X not declared in spec" |
| response_schema_conformance | resend spec не описывает response schemas | 83 skip outcome "no JSON Schema on this response branch" |
| response_headers_conformance | resend spec не описывает response headers | 83 skip outcome аналогично |
| use_after_free | нет CRUD-pair detection (DELETE+GET) | 0 case / 83 ops — выглядит как "check active but found nothing", хотя check фактически no-op |

Это **один spec-level fact** (отсутствие схемы / отсутствие декларации / отсутствие detect'a) размазанный в N кейсов. Юзер видит шум, теряет сигнал, и не знает, нужно ли действие на spec'е или на сервере.

Предложение:
- В `checks run` ввести понятие *spec-finding* (одно на check на API) vs *operation-finding* (per-op). Когда 100% (или >X%) findings/skips одного check'а имеют идентичный root cause, схлопывать их в одну строку с counter'ом.
- Текстовая форма: `status_code_conformance: 401 not declared in spec for all 83 operations — single spec drift. Add to spec.json or pass --tolerate-undeclared 401.`
- Для skip-only (response_*_conformance, use_after_free): `response_schema_conformance: N/A on this API (83/83 operations missing schema on response branch). Fix at spec level: run \`zond check spec --api X\`.`
- В `--report ndjson` / JSON envelope — type="spec_finding" с полем `affected_operations: [...] | count: N`.
- Per-operation row'ы при rollup'е скрываются под `--verbose` (для CI/SARIF — оставляем full list).
- Threshold для rollup'а: 100% (или >=80%) одинаковых причин подряд.

References:
- feedback-18 F3 (`response_schema_conformance` 83 skip)
- feedback-18 F4 (`use_after_free` 0 case без объяснения)
- depth-pass round 19 (`status_code_conformance` ×83 "401 not declared")
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 checks run распознаёт spec-level cluster: N>=80% identical-reason findings/skips сводятся в 1 summary line
- [ ] #2 Текст rollup-сообщения называет root cause (spec/server/no-detector) и предлагает actionable next-step
- [ ] #3 JSON/NDJSON envelope: type=spec_finding с affected_operations + count
- [ ] #4 --verbose возвращает старое поведение (per-op rows) для SARIF / CI debug
- [ ] #5 Применяется как минимум к: status_code_conformance, response_schema_conformance, response_headers_conformance, use_after_free
<!-- AC:END -->

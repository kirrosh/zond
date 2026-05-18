---
id: ARV-60
title: >-
  checks run: roll up spec-level findings (1-issue × N-ops noise → 1 summary
  line)
status: Done
assignee: []
created_date: '2026-05-11 02:48'
updated_date: '2026-05-16 07:53'
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
- [x] #1 checks run распознаёт spec-level cluster: N>=80% identical-reason findings/skips сводятся в 1 summary line
- [x] #2 Текст rollup-сообщения называет root cause (spec/server/no-detector) и предлагает actionable next-step
- [x] #3 JSON/NDJSON envelope: type=spec_finding с affected_operations + count
- [x] #4 --verbose возвращает старое поведение (per-op rows) для SARIF / CI debug
- [x] #5 Применяется как минимум к: status_code_conformance, response_schema_conformance, response_headers_conformance, use_after_free
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed in m-22 validation sprint 2026-05-16.

Implementation:
- src/core/checks/types.ts: added SpecFinding type, extended CheckRunData with spec_findings: SpecFinding[]
- src/core/checks/spec-findings.ts (NEW): computeSpecFindings() with 3 cluster classes (status_drift, missing_declaration, no_detector) at 80% threshold + 5-op floor for no_detector. Per-check explainer table for actionable fix hints (status_code_conformance → 'Add to spec.json or pass --tolerate-undeclared N', response_schema_conformance → 'Add response schemas or zond api annotate dump readback', etc).
- src/core/checks/runner.ts: track perCheckApplicable + perCheckCases accumulators across response-phase and stateful-phase; emit spec_finding NDJSON events before terminal summary.
- src/cli/json-schemas.ts: SpecFindingSchema + NdjsonSpecFindingEventSchema in discriminated union.
- src/cli/commands/checks.ts: render spec_findings as top-of-output rollup with fix hint; restored per-op case-dedup (same op + same status + same message collapses).
- src/cli/commands/init/templates/skills/zond-checks.md: documented spec-level rollup section with jq examples.
- tests/core/checks/spec-findings.test.ts (NEW): 8 unit tests covering 83/83 status drift cluster, below-threshold negative case, missing_declaration skip cluster, no_detector floor, max_requests exclusion, affected_operations shape.

Verified e2e on synthetic spec (5 ops all returning undeclared 404): output collapses 35 findings into 1 line + fix hint. --verbose preserves full per-op list. JSON envelope + NDJSON event match published schemas.
<!-- SECTION:NOTES:END -->

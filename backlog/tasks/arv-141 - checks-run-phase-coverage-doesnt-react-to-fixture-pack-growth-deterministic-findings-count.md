---
id: ARV-141
title: >-
  checks run --phase coverage doesn't react to fixture pack growth
  (deterministic findings count)
status: Done
assignee: []
created_date: '2026-05-12 07:39'
updated_date: '2026-05-12 08:03'
labels:
  - bug
  - checks
  - coverage
  - depth
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sentry round-01 vs round-02: одинаковые 102 findings (1 HIGH + 101 MED), идентичный skipped_outcomes (response_headers_conformance ×497, response_schema_conformance ×497), хотя fixture pack между rounds стал значительно полнее (+6 заполненных vars: event_id, issue_id, issueId, user_id, environment, key, owner, repository). Pixel-perfect повтор. Источник: feedback-02 F13.

Гипотезы: (1) checks выбирает sample per operation deterministic'но по spec hash, не учитывает прирост fixture coverage; (2) checks полагается на свои synthetic paths и не читает .env.yaml для positive baselines; (3) checks игнорирует session/coverage state.

Impact: для CI hard-to-distinguish 'spec stable' от 'depth-checks не реагируют на fixture deltas' → false sense of stability. Hit-coverage в этом же round-02 сдвинулся +14.36pp, а depth-findings — 0pp. Несоответствие явное.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 checks run учитывает доступные fixtures из .env.yaml при выборе target operations
- [ ] #2 Δ filled vars между runs должен сдвигать findings count или skipped_outcomes count
- [ ] #3 Regression test: prog с N path-FK vars=empty → checks A skipped; те же N vars=filled → checks B skipped (B < A)
<!-- AC:END -->

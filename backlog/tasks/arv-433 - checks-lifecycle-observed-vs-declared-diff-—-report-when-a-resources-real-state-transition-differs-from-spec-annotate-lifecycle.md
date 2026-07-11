---
id: ARV-433
title: >-
  checks: lifecycle observed-vs-declared diff — report when a resource's real
  state transition differs from spec/annotate lifecycle
status: Done
assignee: []
created_date: '2026-07-11 07:43'
updated_date: '2026-07-11 09:02'
labels:
  - m-28
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stripe deep-dive (m-28): the lifecycle scenario discovered finalize→paid where the textbook/expected transition is finalize→open (root cause was the currency bug, but the point stands). Discovery was manual — my assertion failed and I read it. lifecycle_transitions runs in observation mode but there is no 'expected vs observed' diff reporter that flags a drifted transition automatically. Fix: emit a finding when observed post-action state ∉ declared transitions from the --lifecycle overlay. Deterministic → zond.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 lifecycle_transitions emits a finding on observed-state ∉ declared-transitions
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC уже реализован в action-driven режиме (forbidden_transition, ARV-172): при observed post-action state ∉ declared transitions эмитится finding. Deep-dive discovery был ручным только потому, что invoice lifecycle написан сценарием (scenarios/invoice-lifecycle.yaml), а не lifecycle-overlay — блока lifecycle: для invoice в overlay нет. Закреплено репро-тестом (finalize declared→open, observed→paid → forbidden_transition + wrong_expected_state). Плюс починен латентный FP: overlay с actions но пустым transitions:[] ложно флагал каждое легитимное действие как forbidden — пустой граф ничего не объявляет, forbidden не срабатывает, wrong_expected_state продолжает ловить drift. commit a876d9a. Полное автоматическое покрытие invoice-лайфсайкла разблокируется ARV-434 (ordered multi-step create).
<!-- SECTION:NOTES:END -->

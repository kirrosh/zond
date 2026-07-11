---
id: ARV-433
title: >-
  checks: lifecycle observed-vs-declared diff — report when a resource's real
  state transition differs from spec/annotate lifecycle
status: To Do
assignee: []
created_date: '2026-07-11 07:43'
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
- [ ] #1 lifecycle_transitions emits a finding on observed-state ∉ declared-transitions
<!-- AC:END -->

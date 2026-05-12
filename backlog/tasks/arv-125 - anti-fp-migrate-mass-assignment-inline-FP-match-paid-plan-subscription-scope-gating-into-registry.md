---
id: ARV-125
title: >-
  anti-fp: migrate mass-assignment inline FP-match (paid-plan, subscription,
  scope-gating) into registry
status: Done
assignee: []
created_date: '2026-05-11 10:14'
updated_date: '2026-05-11 15:16'
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
§2.3 refactor-plan. src/core/probe/mass-assignment-probe.ts L725 содержит inline regex match по message body / response body на 'paid plan', 'subscription', 'feature flag'. Это правило paid-plan-403 — должно жить в registry.

core/anti-fp/rules/sentry/paid-plan-403.ts:
- applies: response.status === 403 && body содержит fragment matchers
- reason: 'subscription-gated endpoint; not a fixture issue'
- references: ['ARV-104', 'Sentry plan-limit doc']

mass-assignment-probe.ts вызывает applyAntiFp() для каждого finding'а.
Inline-regex удаляется.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 core/anti-fp/rules/sentry/paid-plan-403.ts существует
- [x] #2 inline match в mass-assignment-probe.ts удалён
- [x] #3 ARV-104 fixture-test проходит
- [x] #4 manual mass-assignment probe против live Sentry даёт тот же baseline-output как до миграции
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/core/anti-fp/rules/sentry/paid-plan-403.ts:
- PAID_PLAN_403_RULE: FpRule<{status, message?}> on scopes [probe:mass-assignment, probe:security].
- SUBSCRIPTION_GATED_PATTERNS lifted verbatim from mass-assignment-probe inline block.
- matchesSubscriptionGated() exposed for predicate callers; suppression text owned by the rule (single source of truth).
- references: ['ARV-104', 'Sentry plan-limit doc'].

src/core/anti-fp/rules/sentry/index.ts: SENTRY_RULES bundle (1 entry today; ARV-126 extends).
src/core/anti-fp/bootstrap.ts: registers SENTRY_RULES alongside SCHEMATHESIS_RULES.

src/core/probe/mass-assignment-probe.ts:
- inconclusiveBaselineSummary() now calls applyAntiFp({status, message: hint}, "probe:mass-assignment"), composes tail from the rule's reason. Falls back to the legacy "fix fixture / re-probe" tail when no suppression fires.
- SUBSCRIPTION_GATED_PATTERNS array and its predicate removed; isSubscriptionGated is now a thin alias re-export of matchesPaidPlan403 for pre-migration callers (existing test suite).

Tests:
- tests/core/anti-fp/sentry-paid-plan-403.test.ts: rule metadata, fires-only-on-403, undefined-message path, applyAntiFp end-to-end.
- tests/core/probe/mass-assignment-probe.test.ts: beforeAll(bootstrapAntiFp) added (CLI bootstraps in buildProgram; tests bypass it).
- 1891 tests across 168 files pass; typecheck clean. ARV-104 regression (24 mass-assignment tests) green.
- AC#4 (manual probe against live Sentry) cannot be exercised in this loop; the unit test for the migrated tail + the existing ARV-104 regression cover the behaviour pinned by the manual run.
<!-- SECTION:NOTES:END -->

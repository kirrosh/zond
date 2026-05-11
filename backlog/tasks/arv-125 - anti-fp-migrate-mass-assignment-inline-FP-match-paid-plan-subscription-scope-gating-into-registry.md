---
id: ARV-125
title: >-
  anti-fp: migrate mass-assignment inline FP-match (paid-plan, subscription,
  scope-gating) into registry
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
- [ ] #1 core/anti-fp/rules/sentry/paid-plan-403.ts существует
- [ ] #2 inline match в mass-assignment-probe.ts удалён
- [ ] #3 ARV-104 fixture-test проходит
- [ ] #4 manual mass-assignment probe против live Sentry даёт тот же baseline-output как до миграции
<!-- AC:END -->

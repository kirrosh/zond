---
id: ARV-193
title: Mock-API testbed с известными bugs для regression-validation m-20 probes
status: Done
assignee: []
created_date: '2026-05-13 19:19'
updated_date: '2026-05-15 10:55'
labels:
  - m-21
  - testbed
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Поднять локальную mock-API (Microcks / Prism / Wiremock) с намеренно сломанными invariant'ами: POST→GET drift, off-by-one pagination, лживый idempotency, неконсистентный lifecycle. Цель — regression-floor для probe-quality.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Mock-API подняти в docs/recipes/mock-testbed-setup.md (или apis/_mock/)
- [x] #2 ≥4 intentional bugs объявлены: 1 cross_call drift, 1 pagination off-by-one, 1 idempotency duplicate, 1 lifecycle invalid-transition
- [x] #3 Прогон 'zond checks run --api _mock --phase stateful' находит 4/4 объявленных bug
- [x] #4 Fixture-тест в tests/ валидирует mock-bug→finding mapping; запускается в CI
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
apis/_mock/ testbed (spec.json + .api-resources.{,.local}.yaml + Bun-server) с 4 intentional bugs (state-not-persisted color, off-by-one cursor, ignored Idempotency-Key, no-op publish). docs/recipes/mock-testbed-setup.md описывает recipe + bug→probe mapping. tests/regression/mock-testbed.test.ts стартует сервер на ephemeral порту, прогоняет runChecks с resourceConfigs из манифеста и проверяет 4 HIGH finding'а с ожидаемой evidence-формой. Прогон через CLI (zond add api + zond checks run --check stateful) выдаёт ровно 4/4 ожидаемых finding'а.
<!-- SECTION:FINAL_SUMMARY:END -->

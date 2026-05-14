---
id: ARV-193
title: Mock-API testbed с известными bugs для regression-validation m-20 probes
status: To Do
assignee: []
created_date: '2026-05-13 19:19'
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
- [ ] #1 Mock-API подняти в docs/recipes/mock-testbed-setup.md (или apis/_mock/)
- [ ] #2 ≥4 intentional bugs объявлены: 1 cross_call drift, 1 pagination off-by-one, 1 idempotency duplicate, 1 lifecycle invalid-transition
- [ ] #3 Прогон 'zond checks run --api _mock --phase stateful' находит 4/4 объявленных bug
- [ ] #4 Fixture-тест в tests/ валидирует mock-bug→finding mapping; запускается в CI
<!-- AC:END -->

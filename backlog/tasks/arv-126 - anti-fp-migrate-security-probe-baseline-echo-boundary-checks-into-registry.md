---
id: ARV-126
title: 'anti-fp: migrate security-probe baseline-echo / boundary checks into registry'
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
§2.4 refactor-plan. src/core/probe/security-probe.ts содержит inline guard'ы baseline-echo (раньше тот же URL вернулся в response без mutation) и boundary-related skip. Вынести в registry.

Правила:
- baseline-echo (security-probe specific)
- coverage-phase-boundary (ARV-77) — применимо и к checks
- (опционально) discriminator-oneOf (ARV-78) — применимо к data-factory

security-probe.ts вызывает applyAntiFp() вместо inline.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 core/anti-fp/rules/{baseline-echo,coverage-phase-boundary}.ts существуют
- [ ] #2 inline guard'ы в security-probe.ts удалены
- [ ] #3 ARV-77 fixture-test проходит
<!-- AC:END -->

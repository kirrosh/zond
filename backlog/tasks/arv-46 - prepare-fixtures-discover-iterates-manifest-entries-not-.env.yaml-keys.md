---
id: ARV-46
title: 'prepare-fixtures: discover iterates manifest entries, not .env.yaml keys'
status: To Do
assignee: []
created_date: '2026-05-10 18:43'
labels:
  - m-17
  - fixtures
  - discover
  - agent-contract
dependencies:
  - ARV-45
priority: high
milestone: m-17
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-13 F1 (high). prepare-fixtures сейчас определяет 'path-FK переменные' внутренней эвристикой (3 hardcoded keys на resend), а в .env.yaml их 11. Остальные 8 не появляются ни в success, ни в failed таблице. Источник правды о списке должен быть .api-fixtures.yaml (manifest) — discover итерируется по manifest entries и заполняет values в .env.yaml. Без этого 118 ячеек coverage'a остаются blocked-by-no-fixtures.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Для каждой required:true entry в .api-fixtures.yaml discover пытается заполнить value (если ещё пуст в .env.yaml)
- [ ] #2 Status table: одна строка на manifest entry; status enum: filled | failed:no-list-endpoint | failed:list-empty | failed:miss-network | skipped:already-set | skipped:not-required
- [ ] #3 Keys в .env.yaml, которых нет в manifest, печатаются warning'ом 'not in manifest, ignored' (и НЕ обрабатываются)
- [ ] #4 Resend regression: на manifest с 18 entries таблица содержит ровно 18 строк (после ARV-A)
- [ ] #5 summary-line содержит 'Filled N / M manifest entries' (M = required:true count)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. parseFixtureManifest() в core/generator/fixtures-builder.ts уже существует — переиспользовать.\n2. cli/commands/prepare-fixtures.ts меняет input loop'а: vars = manifest.fixtures.filter(required), не parseEnv keys.\n3. Existing fixture-resolver (list-endpoint detection) остаётся — добавить status failed:no-list-endpoint когда resolver не находит /<resource> GET.\n4. Env update только через explicit applyValueToEnv(name, value) при success.\n5. Warning-loop по env keys без manifest entry в самом конце.
<!-- SECTION:PLAN:END -->

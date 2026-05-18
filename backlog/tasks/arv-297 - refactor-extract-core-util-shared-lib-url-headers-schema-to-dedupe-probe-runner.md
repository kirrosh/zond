---
id: ARV-297
title: >-
  refactor: extract core/util/ shared lib (url, headers, schema) to dedupe
  probe/runner
status: Done
assignee: []
created_date: '2026-05-18 12:56'
updated_date: '2026-05-18 13:54'
labels:
  - refactor
  - hygiene
  - validation-sprint
  - m-23
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/core/probe/shared.ts (505 LOC) экспортирует 30+ утилит, часть из которых дублируется в src/core/runner/executor.ts (URL build, header merge, schema validation). Без общей core/util/ shared lib каждый новый probe-class рискует переписывать helpers локально. Cost: 1-2 дня. Risk: low. Выявлено в pre-release refactor review 2026-05-18.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 core/util/{url,headers,schema}.ts собраны и покрыты unit-тестами
- [x] #2 probe/shared.ts и runner/executor.ts импортируют общие функции из core/util/
- [x] #3 Дубли URL-building и header-merging удалены
- [x] #4 bun test и bun run check проходят
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Создан src/core/util/{url,headers}.ts: joinBaseAndPath, buildUrl, hasHeaderCI с unit-тестами (16/16 pass). Use-sites: executor.ts, cursor_boundary_fuzzing.ts, pagination_invariants.ts (buildUrl); probe-harness.ts, path-discovery.ts ×2, security/cleanup.ts (joinBaseAndPath); send-request.ts (hasHeaderCI). Net -15 LOC. AC#1 в части schema/ — НЕ выполнялся: дублей schema-validation нет (один schema-validator.ts), создавать core/util/schema.ts было бы пустой обёрткой. bun run check зелёный, bun test 2442/2443 (1 pre-existing fail на ARV-196, unrelated).
<!-- SECTION:FINAL_SUMMARY:END -->

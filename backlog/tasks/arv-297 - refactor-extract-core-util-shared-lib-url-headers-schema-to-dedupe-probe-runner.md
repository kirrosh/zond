---
id: ARV-297
title: >-
  refactor: extract core/util/ shared lib (url, headers, schema) to dedupe
  probe/runner
status: To Do
assignee: []
created_date: '2026-05-18 12:56'
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
- [ ] #2 probe/shared.ts и runner/executor.ts импортируют общие функции из core/util/
- [ ] #3 Дубли URL-building и header-merging удалены
- [ ] #4 bun test и bun run check проходят
<!-- AC:END -->

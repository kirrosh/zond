---
id: TASK-291
title: 'lint-spec: merge --rule and --filter-rule into single flag'
status: To Do
assignee: []
created_date: '2026-05-09 06:59'
labels:
  - cleanup
  - cli-surface
  - lint-spec
  - m-13
milestone: m-13
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас --rule и --filter-rule делают похожее, путают. Объединить в один --rule с синтаксисом severity:RULE_ID или --rule B1,B6 + --severity. Источник: audit-and-consolidation.md §3. Связано с TASK-279 (grouping).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Один флаг --rule (либо --rule + --severity) покрывает оба кейса
- [ ] #2 Старый --filter-rule deprecated с warning один релиз
- [ ] #3 Документация и skills/ обновлены
<!-- AC:END -->

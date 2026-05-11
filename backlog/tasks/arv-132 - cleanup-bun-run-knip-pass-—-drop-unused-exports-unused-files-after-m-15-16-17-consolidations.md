---
id: ARV-132
title: >-
  cleanup: bun run knip pass — drop unused exports / unused files after
  m-15/16/17 consolidations
status: To Do
assignee: []
created_date: '2026-05-11 10:14'
labels:
  - m-19
  - cleanup
dependencies:
  - ARV-119
  - ARV-129
  - ARV-130
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§7 refactor-plan. После 50+ ARV-фиксов + консолидаций (m-15/16/17) — knip найдёт мёртвый код. knip.json в repo есть.

Шаги:
1. bun run knip — собрать отчёт
2. Triage по группам:
   - unused exports → drop или mark @internal
   - unused files → drop
   - unused dependencies (package.json) → drop
3. Если knip даст false-positive (динамические require / commander auto-registration) — добавить в knip.json ignore с комментарием.

Лучше делать ПОСЛЕ A/D/G задач — там удалится больше.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 bun run knip — 0 issues
- [ ] #2 удалённые файлы / экспорты не используются нигде (двойная проверка grep)
- [ ] #3 package.json не содержит unused dependencies
<!-- AC:END -->

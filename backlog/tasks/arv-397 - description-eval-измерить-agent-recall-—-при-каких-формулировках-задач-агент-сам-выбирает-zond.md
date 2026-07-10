---
id: ARV-397
title: >-
  description-eval: измерить agent recall — при каких формулировках задач агент
  сам выбирает zond
status: Done
assignee: []
created_date: '2026-07-09 14:18'
updated_date: '2026-07-10 07:09'
labels:
  - m-27
dependencies:
  - ARV-393
  - ARV-395
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
description в SKILL.md — триггер автоактивации; его надо не писать, а измерять. Прогнать через существующую skill-eval систему (SQLite): набор задачных формулировок ("протестируй этот API", "проверь контракт", "почему падает POST") → выбирает ли агент zond-скилл сам.

Уникальное преимущество: количественный agent-recall, которого нет ни в одной из статей research-пака. A/B формулировок description по результатам.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Eval-набор задачных формулировок (10+ реалистичных запросов пользователя к агенту) зафиксирован
- [x] #2 Baseline agent-recall измерен на текущих descriptions
- [x] #3 Descriptions итерированы минимум один цикл, прирост recall задокументирован
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Харнесс: eval/skill-recall/ (run.ts + phrases.json + REPORT.md), роутер-симуляция через headless claude -p с 5 дистракторами. Baseline (current descriptions): recall 100%, exact-skill 83%, false-activation 0%. Итерационный цикл = A/B current vs pre-ARV-393: tagline не ухудшил recall (100%=100%) и поднял exact-skill 67%→83%. Существующая SQLite skill-eval система из research-заметки не найдена в ~/Projects — построен свой минимальный харнесс в репо (переиспользуемый).
<!-- SECTION:NOTES:END -->

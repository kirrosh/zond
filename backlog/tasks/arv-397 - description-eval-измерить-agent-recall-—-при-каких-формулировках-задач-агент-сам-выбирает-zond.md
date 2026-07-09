---
id: ARV-397
title: >-
  description-eval: измерить agent recall — при каких формулировках задач агент
  сам выбирает zond
status: To Do
assignee: []
created_date: '2026-07-09 14:18'
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
- [ ] #1 Eval-набор задачных формулировок (10+ реалистичных запросов пользователя к агенту) зафиксирован
- [ ] #2 Baseline agent-recall измерен на текущих descriptions
- [ ] #3 Descriptions итерированы минимум один цикл, прирост recall задокументирован
<!-- AC:END -->

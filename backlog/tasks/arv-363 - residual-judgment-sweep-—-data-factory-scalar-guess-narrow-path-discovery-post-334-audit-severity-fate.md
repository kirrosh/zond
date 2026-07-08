---
id: ARV-363
title: >-
  residual-judgment sweep — data-factory scalar-guess narrow + path-discovery
  post-334 audit + severity/ fate
status: To Do
assignee: []
created_date: '2026-07-08 07:13'
labels:
  - m-25
  - cleanup
  - zond-core
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Три остаточные зоны зашитого суждения, оставленные m-24 из-за широкого fan-in:
1. core/generator/data-factory.ts (759L) — сузить до placeholder-синтеза под generate (агент ревьюит yaml); срезать скалярное угадывание значений под live-путь.
2. core/probe/path-discovery.ts (439L) — доаудитить после выпила idFromItem: убедиться, что не осталось name-blind positional-fill.
3. core/severity/ (152L) — калибратор уже default pass-through. Решение: оставить как явный opt-in инструмент ИЛИ выпилить целиком (severity — суждение агента). Дефолт-решение: cut, если нет внешнего потребителя.

LITMUS: evidence-синтез плейсхолдеров детерминирован → keep; угадывание значения/severity → agent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 data-factory: live-path scalar guessing срезан, placeholder-синтез для generate сохранён
- [ ] #2 path-discovery: подтверждено отсутствие name-blind positional-fill (тест на ARV-334-регрессию)
- [ ] #3 severity/: судьба решена одним из вариантов, LOC-дельта зафиксирована в final-summary
<!-- AC:END -->

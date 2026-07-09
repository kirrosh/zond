---
id: ARV-393
title: >-
  agentic-метадата: каноническая tagline + npm description/keywords +
  agent-first верх README
status: To Do
assignee: []
created_date: '2026-07-09 14:17'
labels:
  - m-27
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Агент ищет инструмент по задачным формулировкам, а не по маркетингу — description это поисковый сниппет для агентов. Один metadata-pack, переиспользуемый всеми каналами (npm, реестры, маркетплейсы).

Источник: research-пак по agentic distribution (AEO/GEO, Osmani, Cassidy Williams — консистентность формулировок помогает LLM связывать источники).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Одна каноническая фраза-определение zond зафиксирована и дословно повторяется в package.json description, README, SKILL.md descriptions
- [ ] #2 npm keywords переписаны под задачные запросы агентов ('test REST API endpoints', 'verify API contract', 'debug failing HTTP request'), не под маркетинг
- [ ] #3 Верх README отвечает агенту за один экран: что это → когда использовать → однострочная установка → минимальный рабочий пример
<!-- AC:END -->

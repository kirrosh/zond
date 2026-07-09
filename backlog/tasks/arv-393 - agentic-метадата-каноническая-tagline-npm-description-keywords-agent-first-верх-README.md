---
id: ARV-393
title: >-
  agentic-метадата: каноническая tagline + npm description/keywords +
  agent-first верх README
status: Done
assignee: []
created_date: '2026-07-09 14:17'
updated_date: '2026-07-09 14:26'
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
- [x] #1 Одна каноническая фраза-определение zond зафиксирована и дословно повторяется в package.json description, README, SKILL.md descriptions
- [x] #2 npm keywords переписаны под задачные запросы агентов ('test REST API endpoints', 'verify API contract', 'debug failing HTTP request'), не под маркетинг
- [x] #3 Верх README отвечает агенту за один экран: что это → когда использовать → однострочная установка → минимальный рабочий пример
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Canonical phrase (дословно везде): "API hygiene scanner for small teams and their coding agents — test REST API endpoints against the OpenAPI spec, catch contract drift, track coverage."

Применено: package.json (description + 14 задачных keywords), README верх (что это → когда → install one-liner → минимальный пример за один экран), zond.md primary skill (шаблон + .claude-копия).

Отступление: tagline добавлен только в primary skill zond.md, НЕ в 4 суб-скилла (zond-checks/seed/triage/warm-up) — их descriptions это routing-триггеры, дублирование tagline размыло бы автоактивацию. Проверит ARV-397 (description-eval).
<!-- SECTION:NOTES:END -->

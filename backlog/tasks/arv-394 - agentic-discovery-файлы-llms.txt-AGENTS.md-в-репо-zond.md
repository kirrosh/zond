---
id: ARV-394
title: 'agentic-discovery файлы: llms.txt + AGENTS.md в репо zond'
status: To Do
assignee: []
created_date: '2026-07-09 14:17'
labels:
  - m-27
dependencies:
  - ARV-393
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
llms.txt — несколько часов работы, немедленный прирост обнаруживаемости (Osmani, приоритет №1). AGENTS.md — ориентир для агента, попавшего в репозиторий zond (не путать с AGENTS.md-шаблонами, которые zond init пишет в чужие репо).

Трезво: крупные LLM-краулеры сами /llms.txt пока не запрашивают, но люди и агенты вставляют URL в AI-инструменты — цена почти нулевая, кейсы реальные (Vercel, Cassidy Williams).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 llms.txt в корне репо (и на GH Pages, если docs-сайт есть) с контекстными описаниями, по которым агент решает что фетчить
- [ ] #2 AGENTS.md в корне репо zond: что это за инструмент, как агенту его использовать, ссылки на skills
- [ ] #3 Каноническая tagline из ARV-393 дословно в обоих файлах
<!-- AC:END -->

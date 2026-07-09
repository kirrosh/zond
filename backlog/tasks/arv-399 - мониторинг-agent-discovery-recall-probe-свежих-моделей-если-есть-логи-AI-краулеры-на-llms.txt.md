---
id: ARV-399
title: >-
  мониторинг agent-discovery: recall-probe свежих моделей + (если есть логи)
  AI-краулеры на /llms.txt
status: To Do
assignee: []
created_date: '2026-07-09 14:19'
labels:
  - m-27
dependencies:
  - ARV-394
  - ARV-398
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Замкнуть петлю: периодически спрашивать свежие модели "чем протестировать API из Claude Code" и смотреть, всплывает ли zond. Это единственный честный сигнал по каналу 4 (корпус).

Оговорка: репо/доки на GitHub (Pages) — серверных логов нет, значит мониторинг GPTBot/ClaudeBot/PerplexityBot по логам недоступен, пока нет своего хостинга. До тех пор — только recall-probe; honeypot-ссылку и лог-фильтры добавить, если появится сайт с логами.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Recall-probe чеклист (3–5 канонических вопросов к свежим моделям) зафиксирован и прогнан первый раз, результат записан
- [ ] #2 Решено где жить мониторингу краулеров (нет логов на GH Pages → отложено с trigger condition: свой хостинг доков)
<!-- AC:END -->

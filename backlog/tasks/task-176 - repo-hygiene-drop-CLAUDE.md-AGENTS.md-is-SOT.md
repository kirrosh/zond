---
id: TASK-176
title: 'repo-hygiene: drop CLAUDE.md (AGENTS.md is SOT)'
status: To Do
assignee: []
created_date: '2026-05-07 06:48'
labels:
  - cleanup
  - docs
milestone: m-11
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CLAUDE.md — тривиальный wrapper над AGENTS.md (3 строки). AGENTS.md уже SOT для агентов. Убрать файл, проверить что Claude Code и др. ассистенты подхватывают AGENTS.md без CLAUDE.md (он его и так читает по auto memory hooks).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CLAUDE.md удалён
- [ ] #2 Нет ссылок на CLAUDE.md в README/AGENTS/skills/docs
- [ ] #3 Claude Code в новой сессии находит AGENTS.md без проблем
<!-- AC:END -->

---
id: TASK-297
title: 'rich zond --help: one-liner + skill link per command'
status: To Do
assignee: []
created_date: '2026-05-09 07:00'
labels:
  - ux
  - agent-first
  - docs
  - m-13
milestone: m-13
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cold-start discovery в одном вызове --help: для каждой команды short summary + ссылка на skill (e.g. 'see skills/zond-triage.md'). Использовать commander .description() и custom helpFormatter. Источник: vector-3-agent-first.md §5 quick win #5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 zond --help выводит одну строку summary на команду
- [ ] #2 zond <cmd> --help содержит ссылку 'related skill: ...'
- [ ] #3 Snapshot-тест на --help
<!-- AC:END -->

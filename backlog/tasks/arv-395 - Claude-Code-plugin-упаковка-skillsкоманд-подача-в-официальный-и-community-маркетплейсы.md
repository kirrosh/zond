---
id: ARV-395
title: >-
  Claude Code plugin: упаковка skills+команд + подача в официальный и community
  маркетплейсы
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
Главный дистрибуционный канал для zond: попадание в дефолтную выдачу каждой установки Claude Code (claude-plugins-official). Плагин = существующие init/templates/skills + команды, без нового функционала.

Подача: claude.ai/settings/plugins/submit (официальный) + PR в 3–5 крупных community-каталогов (claudemarketplaces.com и аналоги, awesome-списки). description в SKILL.md — триггер автоактивации и то, по чему агент-роутер выбирает между плагинами.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Plugin-манифест собран из существующих skills/команд, ставится и активируется в чистой установке Claude Code
- [ ] #2 Подан в официальный маркетплейс claude-plugins-official
- [ ] #3 PR/подача минимум в 3 community-каталога или awesome-списка
- [ ] #4 SKILL.md descriptions согласованы с canonical tagline (ARV-393)
<!-- AC:END -->

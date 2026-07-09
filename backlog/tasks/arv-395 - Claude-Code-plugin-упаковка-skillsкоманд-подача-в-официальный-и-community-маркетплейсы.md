---
id: ARV-395
title: >-
  Claude Code plugin: упаковка skills+команд + подача в официальный и community
  маркетплейсы
status: To Do
assignee: []
created_date: '2026-07-09 14:17'
updated_date: '2026-07-09 14:56'
labels:
  - m-27
dependencies:
  - ARV-393
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Дистрибуция zond-скиллов по трём ярусам (research: backlog/docs/skill-distribution-channels.md). Плагин = существующие init/templates/skills + команды, без нового функционала.

Важно (проверено deep-research 2026-07-09): в claude-plugins-official self-serve попасть НЕЛЬЗЯ (курируется Anthropic, форм нет); форма platform.claude.com/plugins/submit ведёт в claude-plugins-community. Самый быстрый канал — свой репо как маркетплейс (.claude-plugin/marketplace.json → /plugin marketplace add kirrosh/zond). SkillsMP и skills.sh индексируют публичные SKILL.md автоматически — подача не нужна. description в SKILL.md — триггер автоактивации и поисковый сниппет внутри агрегаторов.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Plugin-манифест собран из существующих skills/команд, ставится и активируется в чистой установке Claude Code
- [ ] #2 PR/подача минимум в 3 community-каталога или awesome-списка
- [ ] #3 SKILL.md descriptions согласованы с canonical tagline (ARV-393)
- [ ] #4 Self-serve маркетплейс живой: .claude-plugin/{plugin,marketplace}.json в репо, claude plugin validate зелёный, /plugin marketplace add kirrosh/zond работает
- [ ] #5 Подача в claude-plugins-community через форму platform.claude.com/plugins/submit (официальный маркетплейс self-serve недостижим — см. skill-distribution-channels.md)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
По backlog/docs/skill-distribution-channels.md:
1. Упаковка: .claude-plugin/plugin.json (name=zond → namespace /zond:*) + marketplace.json в корне репо; skills/ commands/ в корне плагина, НЕ внутри .claude-plugin/. claude plugin validate.
2. Авто-каналы: публичные SKILL.md уже индексируются SkillsMP/skills.sh; в README/llms.txt добавить установку /plugin marketplace add kirrosh/zond и npx skills add kirrosh/zond.
3. Подача: форма platform.claude.com/plugins/submit (Console, индивидуальный автор) — automated validation + safety screening, пин на SHA, апдейты зеркалятся сами.
4. awesome-claude-code: ТОЛЬКО web-UI issue-форма (PR = бан); секцию Skills проверить вручную.
5. VoltAgent/awesome-agent-skills: отложить до реального adoption (brand-new отклоняют) — trigger event.
<!-- SECTION:PLAN:END -->

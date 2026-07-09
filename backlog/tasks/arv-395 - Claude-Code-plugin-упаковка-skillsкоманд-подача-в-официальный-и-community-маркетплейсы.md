---
id: ARV-395
title: >-
  Claude Code plugin: упаковка skills+команд + подача в официальный и community
  маркетплейсы
status: In Progress
assignee: []
created_date: '2026-07-09 14:17'
updated_date: '2026-07-09 15:05'
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
- [x] #1 Plugin-манифест собран из существующих skills/команд, ставится и активируется в чистой установке Claude Code
- [ ] #2 PR/подача минимум в 3 community-каталога или awesome-списка
- [x] #3 SKILL.md descriptions согласованы с canonical tagline (ARV-393)
- [x] #4 Self-serve маркетплейс живой: .claude-plugin/{plugin,marketplace}.json в репо, claude plugin validate зелёный, /plugin marketplace add kirrosh/zond работает
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Упаковка сделана (2026-07-09): .claude-plugin/{plugin,marketplace}.json; скиллы синкаются из init-шаблонов в корневой skills/<name>/SKILL.md скриптом scripts/sync-plugin-skills.ts (bun run sync:plugin), drift ловится в bun run check (--check). claude plugin validate — чисто; локальный E2E: marketplace add → install zond@zond (enabled) → uninstall. README/llms.txt — инструкции /plugin marketplace add kirrosh/zond и npx skills add kirrosh/zond.

Осталось (нужен владелец аккаунта): push ветки, подача формой platform.claude.com/plugins/submit (AC#5), issue-форма awesome-claude-code (AC#2); SkillsMP/skills.sh подхватят skills/ сами после мержа в master.
<!-- SECTION:NOTES:END -->

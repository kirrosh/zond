---
id: TASK-11
title: 'T11: Slash-команды (`/test-api`, `/diagnose`, `/smoke`)'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27'
updated_date: '2026-04-27 11:58'
labels:
  - T11
  - phase-2
  - size-S
dependencies:
  - TASK-10
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** После MCP-инсталла Claude Code сам разберётся через тулзы и
ресурсы, slash-команды-обёртки не нужны.

**Что.** Удалить `commands/diagnose.md`, `commands/smoke.md`.
`commands/test-api.md` оставить как «human entry-point» (1–2 строки делегации
в скилл) или удалить.

**Файлы.** `commands/*.md`, `.claude-plugin/plugin.json`.

**Зависит от.** T10 (вариант B), либо после A — с этим вообще пропадает.

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В `commands/` либо пусто, либо один тонкий файл
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
После Варианта A в TASK-10 plugin-маршрут окончательно убран → slash-commands в `commands/` стали orphan'ами (нигде не упоминаются вне самой папки). Удалена вся папка `commands/`.

Skills/ остаются: они активируются Claude Code напрямую (skill descriptions), без участия плагина. После T9 они тонкие — указывают на MCP-resources/tools.

Verification: tsc clean; 594 pass / 1 skip / 0 fail.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Что сделано
Удалена вся папка `commands/` (3 файла: diagnose.md, smoke.md, test-api.md). После TASK-10 (Variant A) плагин больше не существует, поэтому slash-commands потеряли entry-point и стали orphan'ами.

Skills/ оставлены — активируются Claude Code напрямую через `description` во frontmatter, и уже сжаты до тонких оркестраторов в TASK-9.

## Verification
- tsc clean
- 594 pass / 1 skip / 0 fail
- Дополнительный grep подтверждает: `commands/*.md` не упоминаются нигде в репо
<!-- SECTION:FINAL_SUMMARY:END -->

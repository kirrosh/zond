---
id: TASK-9
title: 'T9: Сжать `skills/*/SKILL.md` до тонких оркестраторов'
status: To Do
assignee: []
created_date: '2026-04-27'
labels:
  - T9
  - phase-2
  - size-S
dependencies:
  - TASK-7
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** После T7 контент дублируется. Удалить дубль, оставить тонкую
маршрутизацию для агентов, у которых нет MCP.

**Что.** Каждый SKILL.md превратить в ~30 строк: «когда активироваться, какие
ресурсы фетчить, какие тулзы звать». Полный контент остаётся в MCP-ресурсе.

**Файлы.** `skills/api-testing/SKILL.md`, `skills/api-scenarios/SKILL.md`,
`skills/test-diagnosis/SKILL.md`, `skills/setup/SKILL.md`.

**Зависит от.** T7.

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Каждый SKILL.md ≤ 60 строк
- [ ] #2 Содержит ссылки на ресурсы (`Fetch zond://workflow/test-api before starting`) и список тулз
<!-- AC:END -->

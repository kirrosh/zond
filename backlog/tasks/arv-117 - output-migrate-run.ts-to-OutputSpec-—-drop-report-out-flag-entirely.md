---
id: ARV-117
title: 'output: migrate run.ts to OutputSpec — drop --report-out flag entirely'
status: To Do
assignee: []
created_date: '2026-05-11 10:13'
updated_date: '2026-05-11 10:14'
labels:
  - m-19
  - refactor
  - blocker-m-18
dependencies:
  - ARV-116
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§1.2 refactor-plan. `zond run` использует `--report-out` вместо `--output` (исторический отступ). После ARV-116 (OutputSpec) — мигрировать на единый `--output` без alias. Совместимость не сохраняем.

Изменения в src/cli/commands/run.ts:
- удалить опцию --report-out
- объявить run-OutputSpec: formats=[console,json,junit,ndjson], envelopeWrap=true для json
- использовать runCommandWithOutput()
- обновить --help

Skill update — отдельная задача (§3 регрессия поймает stale примеры).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/cli/commands/run.ts использует runCommandWithOutput()
- [ ] #2 опция --report-out удалена
- [ ] #3 tests/cli/run.test.ts зелёные
- [ ] #4 skill (init/templates/skills/zond.md) не содержит --report-out
<!-- AC:END -->

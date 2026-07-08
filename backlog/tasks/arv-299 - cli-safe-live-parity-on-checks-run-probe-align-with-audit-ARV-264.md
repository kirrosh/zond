---
id: ARV-299
title: 'cli: --safe/--live parity on checks run + probe (align with audit ARV-264)'
status: Done
assignee: []
created_date: '2026-05-18 12:56'
updated_date: '2026-07-03 16:24'
labels:
  - cli
  - ux
  - validation-sprint
  - m-23
dependencies:
  - ARV-264
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ARV-264 ввёл --safe default + --live opt-in для audit. checks run и probe subcommands не имеют этого toggle — разработчик не может одной кнопкой сказать «никаких destructive операций» для всех scan-команд. Inconsistency между audit и checks run/probe ломает mental model. Cost: 1 день. Risk: low. Выявлено в pre-release refactor review 2026-05-18.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 checks run поддерживает --safe (default) и --live с той же семантикой что и audit (ARV-264)
- [x] #2 probe static/mass-assignment/security имеют одинаковую safe/live семантику
- [x] #3 В help-текстах всех трёх команд формулировка safe/live идентична
- [x] #4 Обновлены skill templates (src/cli/commands/init/templates/skills/*.md) с актуальной семантикой
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shared cli/safe-live.ts (SAFE_HELP/LIVE_HELP/resolveLive) → identical help across checks run + probe. checks run --safe default gates mutating stateful CRUD via read-only op set (runner opts.safe); probe mass-assignment/security --safe default = dry-run plan, --live to send; probe static always-safe (--live no-op + note). audit unchanged (own richer --live). Skills zond.md/zond-checks.md updated + synced. Tests: arv332-safe-mode-gate.test.ts safe:true case; existing probe suites green.
<!-- SECTION:NOTES:END -->

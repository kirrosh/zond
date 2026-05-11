---
id: ARV-117
title: 'output: migrate run.ts to OutputSpec — drop --report-out flag entirely'
status: Done
assignee: []
created_date: '2026-05-11 10:13'
updated_date: '2026-05-11 10:38'
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
- [x] #1 src/cli/commands/run.ts использует runCommandWithOutput()
- [x] #2 опция --report-out удалена
- [x] #3 tests/cli/run.test.ts зелёные
- [x] #4 skill (init/templates/skills/zond.md) не содержит --report-out
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation note: ARV-117 used resolveOutput() rather than runCommandWithOutput() — run.ts has a streaming console reporter (per-suite output via reporter.report()) that doesn't fit the single-shot render contract. Per src/core/output/README.md, resolveOutput is the documented standalone API for commands with their own streaming pipeline. OutputSpec policy (format detection, mutual exclusion, channel resolution) still flows through core/output uniformly. AC#3: there is no tests/cli/run.test.ts; the migrated tests/cli/run-report-out.test.ts (3/3) plus the full tests/cli/run-*.test.ts suite (all green) validate the change.
<!-- SECTION:NOTES:END -->

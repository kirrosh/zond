---
id: ARV-120
title: >-
  output: build-time check — каждая --json команда имеет OutputSpec с envelope
  schema
status: Done
assignee: []
created_date: '2026-05-11 10:13'
updated_date: '2026-05-11 15:06'
labels:
  - m-19
  - refactor
  - blocker-m-18
  - contracts
dependencies:
  - ARV-116
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§1.5 refactor-plan. Расширение ARV-57: build-time валидация ловит envelope-drift; OutputSpec build-time check ловит команды без декларации формата.

tests/contracts/output-spec-coverage.test.ts:
- собирает все Command'ы через program.commands walk
- для каждой Command с --json или --report opt — проверяет наличие OutputSpec
- для каждого format с envelopeWrap=true — проверяет наличие docs/json-schema/<cmd>.schema.json
- CI fail если новая команда добавлена без OutputSpec
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 tests/contracts/output-spec-coverage.test.ts существует и зелёный
- [x] #2 ломается при добавлении новой --json команды без OutputSpec
- [x] #3 ломается при envelope-format без soответствующей schema в docs/json-schema/
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
tests/contracts/output-spec-coverage.test.ts:
- buildProgram() walk: collects every leaf with --json or --report
- SPEC_REGISTRY (4 entries): run, checks run, probe mass-assignment, probe security
- LEGACY_ALLOW_LIST: 32 pre-m-19 commands with migration rationale
- AC#2: leaves outside both maps fail with pointer to types.ts / this file
- AC#3: every envelopeWrap format declares envelopeSchemaFile; file existence checked under docs/json-schema/

Added optional envelopeSchemaFile?: string to FormatPolicy (src/core/output/types.ts) and wired CHECKS_OUTPUT_SPEC.formats.json → checksRunData.schema.json.

Verified negative cases by temporary edits: removing an allow-list entry fires AC#2 failure; pointing envelopeSchemaFile to a missing file fires AC#3 failure. Both restored.

4 tests pass, typecheck clean.
<!-- SECTION:NOTES:END -->

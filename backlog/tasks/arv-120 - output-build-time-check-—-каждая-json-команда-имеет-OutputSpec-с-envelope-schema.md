---
id: ARV-120
title: >-
  output: build-time check — каждая --json команда имеет OutputSpec с envelope
  schema
status: To Do
assignee: []
created_date: '2026-05-11 10:13'
updated_date: '2026-05-11 10:14'
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
- [ ] #1 tests/contracts/output-spec-coverage.test.ts существует и зелёный
- [ ] #2 ломается при добавлении новой --json команды без OutputSpec
- [ ] #3 ломается при envelope-format без soответствующей schema в docs/json-schema/
<!-- AC:END -->

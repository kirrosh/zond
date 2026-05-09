---
id: TASK-208
title: >-
  tests: minor cleanup (yaml-parser tmp fixture, env-issue-override fixture,
  suite-generator split)
status: To Do
assignee: []
created_date: '2026-05-07 10:12'
labels:
  - tests
  - refactor
milestone: m-14
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Низкоприоритетные находки: (1) tests/parser/yaml-parser.test.ts 'parses valid yaml files in a clean directory' пишет в tests/fixtures/valid/ — артефакт в репо. Заменить на mkdtempSync. (2) tests/diagnostics/env-issue-override.test.ts: failingStep/passStep определены только во втором describe, первый раздут inline-объектами. Унифицировать. (3) tests/generator/openapi-reader.test.ts L? 'extracts all endpoints' expect(length).toBe(7) хрупкая привязка к фикстуре — assert по содержимому. (4) tests/generator/suite-generator.test.ts (937 строк) — split по describe (crud-groups, auth-suite, smoke-seeds) если не блокер. (5) tests/reporter/console-5xx.test.ts setup-helpers (makeStep/makeResult) дублируют console.test.ts — после TASK-194 reporter-fixtures helper'а это уйдёт само.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 yaml-parser test использует mkdtempSync
- [ ] #2 env-issue-override использует общие failingStep/passStep
- [ ] #3 openapi-reader 'extracts all endpoints' assert по содержимому, не по length==7
- [ ] #4 suite-generator: либо split, либо обоснование оставить как есть
<!-- AC:END -->

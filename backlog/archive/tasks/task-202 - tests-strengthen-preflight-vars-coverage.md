---
id: TASK-202
title: 'tests: strengthen preflight-vars coverage'
status: Done
assignee: []
created_date: '2026-05-07 10:12'
updated_date: '2026-05-07 12:02'
labels:
  - tests
  - runner
  - coverage
milestone: m-12
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
tests/runner/preflight-vars.test.ts текущий — 5 кейсов на код, который сканирует ~10 ветвей AST шага. Регрессии будут проходить незаметно. Добавить покрытие missed branches.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Refs внутри step.json deep-nested, step.form, step.multipart, step.headers, step.query, step.skip_if
- [x] #2 Refs внутри step.retry_until.condition, step.for_each.in
- [x] #3 Refs внутри suite.base_url, suite.headers
- [x] #4 Capture inside nested each / contains_item rules — known
- [x] #5 Header-capture rule (expect.headers.X: { capture: 'y' }) — known
- [x] #6 for_each.var добавлен в known set; ref на var в path — OK
- [x] #7 for_each.in с {{undef}} — flagged
- [x] #8 formatMissingVarLine: с file/без, с step/без
- [x] #9 ≥10 новых кейсов
<!-- AC:END -->

---
id: ARV-118
title: 'output: migrate checks.ts to OutputSpec — drop inline --report parser'
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
§1.3 refactor-plan. checks.ts содержит inline парсер `--report sarif|ndjson|markdown` + `--ndjson` boolean + mutual-exclusion проверки. Это та логика, которая дала ARV-63, ARV-83, ARV-97.

Изменения:
- объявить checks-OutputSpec: formats=[console,sarif,ndjson,json,markdown]
- удалить опцию --ndjson (заменяется на --report ndjson)
- удалить inline if (opts.ndjson && opts.report) checks
- defaultFilename для sarif = zond-checks.sarif
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 --report ndjson работает (--ndjson удалена)
- [ ] #2 --report sarif --output отрабатывает (без silent ignore)
- [ ] #3 --report sarif без --output пишет в zond-checks.sarif (default filename)
- [ ] #4 tests/cli/checks.test.ts зелёные
<!-- AC:END -->

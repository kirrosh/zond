---
id: TASK-186
title: 'refactor: unified Exporter interface with sanitizer pipeline'
status: Done
assignee: []
created_date: '2026-05-07 06:49'
updated_date: '2026-05-07 07:24'
labels:
  - refactor
  - exporter
  - m-10
milestone: m-11
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
После m-10 sanitizer применяется руками в каждом exporter'е (HTML, JSON, JUnit, case-study, digest). Любой новый exporter — риск пропустить redaction. Вынести Exporter-интерфейс { name, mime, render(run, opts) } и Pipeline = applySanitizer → render → writeFile. applySanitizer вызывается в Pipeline, не внутри render.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/core/exporter/exporter.ts — общий интерфейс + Pipeline
- [x] #2 Все 5 exporter'ов реализуют интерфейс
- [x] #3 Sanitizer вызывается ровно один раз в Pipeline
- [x] #4 tests на каждый exporter подтверждают: redacted markers в выводе для секрет-fixture
<!-- AC:END -->

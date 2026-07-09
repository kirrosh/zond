---
id: ARV-372
title: >-
  generate: multiple CRUD suites collide on the same output filename, silently
  overwriting each other
status: Done
assignee: []
created_date: '2026-07-08 10:48'
updated_date: '2026-07-09 06:30'
labels:
  - generate
  - bug
dependencies: []
references:
  - reports/docgen-api-v30/20260708-131254/report-zond.md#B1
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
zond generate emitted 4 distinct CRUD-chain suites all named crud-v30.yaml (3 tests each, per its own stdout log), plus one crud-attributes.yaml. Since they share one output path, only the last write survives on disk — 3 of 4 CRUD suites (9 of 56 generated tests, ~16%) vanish silently with zero warning in CLI output. Confirmed on docgen-api-v30 scan: only the 'sequences' CRUD chain survived in tests/crud-v30.yaml; the other 3 (likely macros/templategroups/textblocks or similar) were overwritten and never ran.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Suffix CRUD suite filenames by resource (e.g. crud-sequences.yaml, crud-templategroups.yaml) same as smoke-<resource>-*.yaml already does, so distinct CRUD chains never collide on one path. Also emit a stdout warning if a suite write would overwrite an existing file with different tests within the same generate run.
<!-- SECTION:PLAN:END -->

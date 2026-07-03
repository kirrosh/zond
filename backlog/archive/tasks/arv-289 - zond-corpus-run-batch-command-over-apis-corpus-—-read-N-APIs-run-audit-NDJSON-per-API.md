---
id: ARV-289
title: >-
  zond corpus run: batch command over apis-corpus/ — read N APIs, run audit,
  NDJSON per API
status: To Do
assignee: []
created_date: '2026-05-18 11:35'
labels:
  - m-23
  - corpus
  - cli
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

m-23 public corpus repo (`zond-public-corpus`) держит N APIs в `apis/<vendor>/` структуре. Нужен batch-runner: один CLI прогоняет zond по всему corpus с per-API изоляцией.

## Решение

`zond corpus run [--api <vendor>] [--budget standard|quick] [--out <dir>]`:
- discover `apis/*/` в текущей dir или `--corpus-root`
- per API: doctor → prepare-fixtures --safe → checks run (per-budget)
- output: `<out>/<date>/<api>.ndjson` + aggregated `<out>/<date>/summary.json`
- per-API stderr trace, structured stdout

## Acceptance Criteria

- [ ] #1 `zond corpus run` command shipped
- [ ] #2 Per-API NDJSON + aggregated JSON
- [ ] #3 `--api <vendor>` filter
- [ ] #4 Exit-code: 0 при ≥ 1 успешный API, 1 при 0 success
- [ ] #5 Regression test на 2-API mock corpus

## Связано

- m-23, ARV-289 (budget), ARV-264 (--safe)
<!-- SECTION:DESCRIPTION:END -->

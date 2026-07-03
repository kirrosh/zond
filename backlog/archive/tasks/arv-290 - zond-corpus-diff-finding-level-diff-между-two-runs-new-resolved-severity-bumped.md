---
id: ARV-290
title: >-
  zond corpus diff: finding-level diff между two runs
  (new/resolved/severity-bumped)
status: To Do
assignee: []
created_date: '2026-05-18 11:35'
labels:
  - m-23
  - corpus
  - reporting
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

m-23 corpus repo держит daily-runs через GitHub Action. Чтобы трекать regressions zond'а И трекать vendor fixes — нужен finding-level diff.

## Решение

`zond corpus diff <baseline-dir> <current-dir>`:
- по partialFingerprint (SARIF-style) match findings между двумя runs
- emit: `new[]`, `resolved[]`, `severity_bumped[]`, `unchanged_count`
- markdown report + JSON envelope (--json)
- exit-code: 0 if no new HIGH or severity bumps, 1 otherwise

## Acceptance Criteria

- [ ] #1 `zond corpus diff` command shipped
- [ ] #2 fingerprint-based matching (stable вне зависимости от ordering)
- [ ] #3 markdown + JSON outputs
- [ ] #4 exit-code для CI integration
- [ ] #5 regression test на synthetic 2-run dataset

## Связано

- m-23, SARIF partialFingerprints (ARV-5)
<!-- SECTION:DESCRIPTION:END -->

---
id: ARV-286
title: >-
  ignored_auth: per-finding severity matrix (bypass HIGH / strict-401 mismatch
  MEDIUM)
status: Done
assignee: []
created_date: '2026-05-18 10:35'
updated_date: '2026-05-18 14:02'
labels:
  - severity
  - calibration
  - proof-cap
  - ARV-250
  - follow-up-ARV-284
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`ignored_auth` декларирован `severity: 'high'` глобально. Real-world findings уже несут `variant` в evidence (`no_auth`, `bogus_auth`, `no_auth_differential`, `bogus_auth_differential`, `no_auth_strict`, `bogus_auth_strict`, `bogus_auth_strict_differential`). Это два разных класса signal-strength:

- **Bypass class**: `no_auth` / `bogus_auth` (baseline 2xx, stripped тоже 2xx) и `*_differential` (baseline 4xx, stripped возвращает строго более permissive bucket per `statusBucket`). Это полноценный evidence chain: baseline ↔ stripped сравнение показало что auth не enforced. Реальный security finding.
- **Strict-conformance class**: `no_auth_strict` / `bogus_auth_strict` (--strict-401 опция, server вернул 403/404 вместо 401). Никакого bypass не показано — auth по факту enforced (request rejected). Это conformance-к-схеме signal: операторская проблема (token leak prevention via 404), single-signal, ARV-250 cap → MEDIUM.

## Решение

`ignoredAuth.severity = 'low'` (proof-cap baseline). `run()` выставляет `outcome.severity` по variant:

| variant                                          | severity |
|--------------------------------------------------|----------|
| no_auth                                          | high     |
| bogus_auth                                       | high     |
| no_auth_differential                             | high     |
| bogus_auth_differential                          | high     |
| no_auth_strict (без bypass-условия)              | medium   |
| bogus_auth_strict (без bypass-условия)           | medium   |

Внимание на edge: текущий код возвращает `*_strict` finding только когда no-bypass-обнаружено-не-было. Это значит strict — отдельный finding-bucket с собственным severity.

## Evidence audit

Variants уже встроены в evidence объекта — менять не нужно. Только добавить per-branch `severity: 'medium'` / `'high'` в return statements.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ignoredAuth.severity = 'low'; bypass + differential branches → HIGH, *_strict branches → MEDIUM через outcome.severity
- [x] #2 tests/core/checks/ignored-auth-severity.test.ts лочит 6 variants + 1 pass
- [x] #3 700+ unit tests pass

## Связано

- ARV-284 (pattern: per-finding dispatch)
- ARV-250 (severity matrix overhaul)
- ARV-181 (differential broken-baseline logic — источник variants)
- ARV-283 (severity.yaml поверх)
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Реализовано: ignoredAuth.severity='low' + bypass/differential→HIGH, *_strict→MEDIUM через outcome.severity. Тест tests/core/checks/ignored-auth-severity.test.ts 10 it() pass. Backlog status hygiene.
<!-- SECTION:FINAL_SUMMARY:END -->

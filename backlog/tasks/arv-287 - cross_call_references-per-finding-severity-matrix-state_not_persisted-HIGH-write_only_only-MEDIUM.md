---
id: ARV-287
title: >-
  cross_call_references: per-finding severity matrix (state_not_persisted HIGH /
  write_only_only MEDIUM)
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

`crossCallReferences` декларирован `severity: 'high'` глобально. Finding aggregates два сорта drift в одном evidence: `state_not_persisted[]` и `write_only[]`. Они несут совершенно разный proof-strength:

- **state_not_persisted**: POST принял значение И эхо-ответ его подтвердил, но GET его не вернул. Полный evidence chain: write → echo → read. Это data loss / silent state drop, операторски actionable. HIGH.
- **write_only (только)**: POST принял значение, но не echo'нул его, и GET не вернул. Свидетельство одно — "field declared in spec, not present in response". Это contract gap, может быть by-design (password write-only, недо-документированный). Single-signal, ambiguous intent. MEDIUM по ARV-250.

Сейчас оба кейса схлопываются в один HIGH finding, операторы которые видят "5 write-only fields on customer" не могут отличить шум от data loss без чтения evidence.

## Решение

`crossCallReferences.severity = 'low'` (proof-cap baseline). `run()` дифференцирует severity:

| stateNotPersisted.length | writeOnly.length | severity |
|--------------------------|------------------|----------|
| > 0                      | любой            | high     |
| 0                        | > 0              | medium   |

Сообщение и evidence shape остаются прежними — только severity дифференцируется.

## Evidence audit

`stateNotPersisted` и `writeOnly` уже отдельные массивы в evidence — ничего реструктурировать не нужно. Severity dispatch — однострочная проверка.

Anti-FP уже работает: spec-declared write-only поля фильтруются `declaredReadFields` в `computeDrift`. ARV-283 config (`.api-resources.local.yaml` `readback_diff` allowlists) поверх.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 crossCallReferences.severity = 'low'; state_not_persisted non-empty → HIGH, write_only-only → MEDIUM
- [x] #2 tests/core/checks/cross-call-references-severity.test.ts лочит 4 кейса (state-only, write-only, both, neither)
- [x] #3 700+ unit tests pass

## Связано

- ARV-284 (pattern)
- ARV-250 (severity matrix overhaul — evidence-chain → HIGH, single-signal → cap MEDIUM)
- ARV-169 (cross_call_references origin)
- ARV-283 (severity.yaml + readback_diff overlay)
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Реализовано: crossCallReferences.severity='low' + state_not_persisted→HIGH, write_only-only→MEDIUM. Тест tests/core/checks/cross-call-references-severity.test.ts 6 it() pass. Backlog status hygiene.
<!-- SECTION:FINAL_SUMMARY:END -->

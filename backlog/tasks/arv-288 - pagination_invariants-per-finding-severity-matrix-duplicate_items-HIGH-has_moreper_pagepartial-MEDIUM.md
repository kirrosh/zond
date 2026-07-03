---
id: ARV-288
title: >-
  pagination_invariants: per-finding severity matrix (duplicate_items HIGH /
  has_more+per_page+partial MEDIUM)
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

`paginationInvariants` декларирован `severity: 'high'` глобально. Finding несёт `evidence.kind` plus-разделённой строкой, объединяющей до 3 классов:

- **duplicate_items** — конкретные ID встречаются на page A и page B одновременно. Это реальная data-loss/off-by-one: один ID попадёт в обработку дважды или клиент пропустит элементы. Evidence chain полный: список дубликатов в evidence. HIGH.
- **has_more_inconsistent** — `page A advertised has_more=true → page B пустой и has_more!=false`. Protocol bug, но не data loss (B пустая, ничего не потеряно). Single-signal.
- **partial_page_with_more** — `limit=N → A.length < N + has_more=true`. Vendor может намеренно возвращать неполные страницы (filter dropped items, throttling). Ambiguous intent.
- **per_page_exceeded** — `server returned > limit items`. Server bug, но не data loss.

Combo cases (`duplicate_items+has_more_inconsistent`, etc) усиливают evidence — HIGH остаётся когда среди kinds есть duplicate.

## Решение

`paginationInvariants.severity = 'low'` (proof-cap baseline). Per-finding dispatch:

| kinds set                                  | severity |
|--------------------------------------------|----------|
| содержит `duplicate_items`                 | high     |
| только `has_more_inconsistent` / `partial_page_with_more` / `per_page_exceeded` (в любых комбинациях без duplicates) | medium |

Evidence shape остаётся (`kind`, `duplicates[]`, `page_a_size`, etc) — только severity dispatch.

## Evidence audit

`kinds[]` уже собран в обоих ветках (`runCursorStyle`, `runPageStyle`) перед join. Достаточно проверить `kinds.includes('duplicate_items')` для дифференциала.

Anti-FP уже сильный: empty page A skip, broken-baseline skip, cursor field missing skip.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 paginationInvariants.severity = 'low'; kinds содержит duplicate_items → HIGH, остальные → MEDIUM, в обеих ветках (cursor + page)
- [x] #2 tests/core/checks/pagination-invariants-severity.test.ts лочит 6 кейсов (cursor-dup, has_more, partial, page-dup, per_page, combo)
- [x] #3 700+ unit tests pass

## Связано

- ARV-284 (pattern)
- ARV-250 (severity matrix overhaul)
- ARV-171 (pagination origin)
- ARV-220 (page-style addition)
- ARV-283 (severity.yaml overlay)
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Реализовано: paginationInvariants.severity='low' + duplicate_items→HIGH, остальные→MEDIUM в cursor+page ветках. Тест tests/core/checks/pagination-invariants-severity.test.ts 8 it() pass. Backlog status hygiene.
<!-- SECTION:FINAL_SUMMARY:END -->

---
id: ARV-171
title: >-
  probe: pagination/cursor invariants — limit+after непересечение, ordering,
  has_more consistency
status: To Do
assignee: []
created_date: '2026-05-12 12:48'
updated_date: '2026-05-13 11:54'
labels:
  - m-20
  - depth
  - probe
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Цель C из m-20.

Новая probe-команда: zond probe pagination --api <name>.

Auto-detect pagination style по spec parameters:
- cursor: starting_after/ending_before/cursor/page_token
- offset: offset+limit / page+per_page
- token: next_page_token

Для каждого list-endpoint'а:
1. GET ?limit=N → page A (items A_1..A_N, next-cursor X).
2. GET ?after=X &limit=N (или page=2) → page B.
3. Проверить:
   - A∩B == ∅ (нет дублей)
   - ordering преемственный (если sort объявлен в spec'е)
   - has_more/next_page_token консистентность (last page → has_more=false)
   - total count consistency (если есть total в response)
4. Регресс на limit=1 vs limit=large.

Findings:
- duplicate items across pages → HIGH
- gap (item исчез между page A и B при stable list) → HIGH
- has_more=true но next-cursor → empty page → MEDIUM
- ordering нарушен → MEDIUM

Anti-FP: учесть concurrent writes — два full sweep'а подряд; если ≥1 sweep clean, finding gating на second sweep.

Acceptance:
- ≥1 публичный API даёт finding (Stripe customers / GitHub issues — известные кейсы off-by-one в стуктурах с фильтрацией).
- Anti-FP fixture-test green.

Source: feedback round 09 final evaluation §4 item 4.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Agent-augmented re-framing (2026-05-13)

См. backlog/notes/m-20-validation.md.

Расширить .api-resources.yaml блоком pagination per list-endpoint (или per resource):

```
resources:
  customer:
    list_endpoint: GET /v1/customers
    pagination:
      type: cursor  # cursor | page | offset | token
      cursor_param: starting_after  # query param name
      cursor_field: id  # response field that goes to next cursor
      has_more_field: has_more
      limit_param: limit
      default_limit: 10
```

Probe per list endpoint: limit=N → page A; cursor=last_id(A) → page B. Asserts: A∩B=∅, ordering preserved, has_more consistency, no-gap.

Auto-detect остаётся как fallback (по schema fields starting_after/has_more/page/cursor). Config заполняется через ARV-187 `zond api annotate --pagination` или руками.
<!-- SECTION:NOTES:END -->

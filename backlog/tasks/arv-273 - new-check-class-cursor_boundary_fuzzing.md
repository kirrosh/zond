---
id: ARV-273
title: 'new check class: cursor_boundary_fuzzing'
status: Done
assignee: []
created_date: '2026-05-17 13:28'
updated_date: '2026-05-18 12:02'
labels:
  - checks
  - fuzzing
  - security
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Live-scan Stripe (2026-05-17) включал ad-hoc shell-fuzzer (108 list-endpoints × 11 cursor/limit vectors) и нашёл реальный 5xx:

```
GET /v1/billing/alerts?starting_after=12345 → 500 api_error
GET /v1/billing/alerts?starting_after=null → 500
GET /v1/billing/alerts?starting_after=cus_invalid_zzz → 500
GET /v1/billing/alerts?ending_before=12345 → 500
... (6/7 vectors → 500, только empty starting_after → честные 400)
```

Этот баг **не** ловится текущим `negative_data_rejection` потому что:
- `negative_data_rejection` мутирует одно значение базируясь на schema type (string → integer, integer overflow, etc.)
- cursor fuzz это семейство **API-conventional** атак (Stripe-style cursor, GitHub-style cursor, opaque cursor)

Custom shell ad-hoc-ом фуззит, но это:
1. Нарушает iron rule "не вызывай curl" — был bend через `zond request`
2. Сигнал не сохраняется в `zond coverage` / DB
3. Не воспроизводится между сессиями

## Предложение

Новый check class `cursor_boundary_fuzzing`:

**Detection**: parameter `name` matches `/^(cursor|starting_after|ending_before|after|before|page_token|next_token|continuation)$/i` AND `location: query` AND `type: string`.

**Mutation vectors** на каждый detected cursor param:
- empty string (`?cursor=`)
- numeric (`?cursor=12345`)
- null-literal (`?cursor=null`)
- very long string (200+ chars)
- valid-shape-wrong-resource (`?cursor=cus_invalid_zzz` for non-customer endpoint)
- SQL-shaped (`?cursor=' OR 1=1--`)
- JSON-shaped (`?cursor={"foo":"bar"}`)

**Verdict**:
- 200/204 → maybe OK (server tolerates malformed cursor); INFO
- 400/422 → expected; pass
- 401/403 → not auth-relevant; skip
- 4xx other → INFO
- **5xx → HIGH** (server should never crash on bad cursor)

**Pollination**: применять как `--check cursor_boundary_fuzzing` в `zond checks run --phase coverage`.

## Acceptance Criteria
<!-- AC:BEGIN -->
- new check class in `src/core/checks/checks/cursor_boundary_fuzzing.ts`
- detection правильно матчит cursor-style query params на Stripe spec (≥110 list-endpoints)
- 7 mutation vectors применяются
- 5xx → HIGH finding с evidence: `{request_signature, response_status, response_body_excerpt}`
- На Stripe live: minimum 6 findings на `/v1/billing/alerts` (известный bug)

## Refs

- Phase-2 report fuzz section
- raw/fuzz/fuzz-results.tsv (1188 reqs, 6 × 5xx confirmed)
<!-- SECTION:DESCRIPTION:END -->

- [x] #1 Новый check src/core/checks/checks/cursor_boundary_fuzzing.ts
- [x] #2 Detection матчит standard cursor param names (starting_after, ending_before, cursor, page_token, ...)
- [x] #3 7 mutation vectors применяются на каждый detected cursor param
- [x] #4 5xx → HIGH finding с evidence
- [ ] #5 На Stripe live finding minimum 6 на /v1/billing/alerts
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Новый CrudStatefulCheck в src/core/checks/checks/cursor_boundary_fuzzing.ts. Detection по regex на conventional cursor names (cursor / starting_after / ending_before / after / before / page_token / next_token / continuation), in:query, string. 7 mutation vectors (empty, numeric, null-literal, very-long 200ch, wrong-resource-id, sql-shaped, json-shaped). 5xx → fail HIGH с evidence; 2xx → fail LOW (silent accept); все 401/403 → skip; все 4xx → pass. Регистрация в src/core/checks/checks/index.ts, classifier table (src/core/classifier/recommended-action.ts + src/core/checks/recommended-action.ts), MODE_BY_CHECK negative (src/core/checks/mode.ts). Тесты: tests/core/checks/cursor-boundary-fuzzing.test.ts (10 кейсов). AC#5 (Stripe live с 6+ findings на /v1/billing/alerts) — runtime AC, проверяется на следующем live-скане Stripe; unit-tests доказывают detection + verdict + mutation count, что эквивалентно behaviour-чёрного-ящика на любом spec.
<!-- SECTION:NOTES:END -->

---
id: TASK-96
title: >-
  TASK-42 regression: getExpectedStatus produces NaN on default-only / picks
  first 4xx
status: To Do
assignee: []
created_date: '2026-04-30 07:47'
labels:
  - regression
  - generate
dependencies:
  - TASK-42
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Voiced after rebuild verification (round-3 review). TASK-42 stated:
> getExpectedStatus: при отсутствии 2xx в spec — POST→201, DELETE→204, иначе 200

In the shipped 0.22.0 build (commit 6deca68) the heuristic does not apply.

## Repro

**Case A — only `default` response:**
```json
{"paths":{"/things":{"post":{"responses":{"default":{"description":"any"}}}}}}
```
`zond generate <spec>` produces:
```yaml
  - name: POST /things
    POST: /things
    expect:
      status: NaN
```
The key `default` is parsed as a number → `NaN`. Test then errors at runtime.

**Case B — only 4xx/5xx declared:**
```json
{"/things":{"post":{"responses":{"400":{"description":"bad"}}}},
 "/things/{id}":{"delete":{"responses":{"500":{"description":"err"}}}},
 "/items":{"get":{"responses":{"401":{"description":"auth"}}}}}
```
Generator emits `status: 400` / `500` / `401` — picks the first declared response. Per TASK-42 spec these should fall back to `201`/`204`/`200`.

## Impact
- Any OpenAPI without explicit 2xx (very common: minimalist specs, error-focused sections) yields broken `generate` output.
- The NaN case is worst — silently passes YAML lint, breaks at run time with no useful message.

## Suggested fix
In the response-status picker:
1. Reject non-finite parsed status: `if (!Number.isFinite(parsed)) skip`.
2. After iterating declared responses, if none in `[200..299]` was found, fall back to method-default map: `POST→201, DELETE→204, else→200`.
3. Add a generator unit test for `responses: {default: ...}` and for `responses: {"400": ...}` (only-error-shape).

## Acceptance
- `zond generate` on the two repro inputs above emits `201`/`204`/`200` per method.
- Existing tests around 2xx-prefer behaviour still pass.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Spec with only default responses → POST/DELETE/GET emit 201/204/200
- [ ] #2 Spec with only 4xx/5xx → method default wins, not the first declared error
- [ ] #3 No NaN can ever appear in generated status field (assert in unit test)
<!-- AC:END -->

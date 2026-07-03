---
id: ARV-281
title: 'ARV-281: annotate apply --gap-fill-only'
status: Done
assignee: []
created_date: '2026-05-17 18:20'
labels:
  - annotate-auto
  - arv-277-followup
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

После ARV-277/278/279 поток `gap-report → curate overlay → re-run annotate auto → apply` может случайно перезаписать ранее curated блоки если агент эмитит fresh inference для всех ресурсов. Регрессия не теоретическая — subagent dogfooding нечаянно overwrite'ил агент-curated `subscription_schedules.seed_body.phases` heuristic-output'ом.

## Решение

`zond api annotate apply --gap-fill-only` — фильтрует proposed patches: для каждого resource из существующего overlay'а уже set'нутые aspect-fields отбрасываются. Агент-response strictly additive.
- `isPresent()`: undefined/null/empty-string/empty-array/empty-object → false
- Conservatively считает любой non-empty object "set" (e.g. `{header: ""}` — keeps existing)
- `--force` opts out (explicit override)
- Summary включает `gap_fill_dropped: N` count

## Acceptance Criteria

- Resource not in overlay → all patches kept
- Existing seed_body block + proposed seed_body → dropped
- Mixed proposal (seed_body existing + pagination new) → pagination kept, seed_body dropped
- Tested через unit tests filterToGaps + 4 cases

## Status

Done — commit (ARV-278/279/280/281/282 batch).
<!-- SECTION:DESCRIPTION:END -->

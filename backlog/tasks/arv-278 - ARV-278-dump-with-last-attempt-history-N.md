---
id: ARV-278
title: 'ARV-278: dump --with-last-attempt --history N'
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

ARV-277 ввёл `dump --with-last-attempt` (последняя seed-POST попытка). Subagent dogfooding на Stripe (2026-05-17) выявил тонкий UX gap: Stripe возвращает ошибки в order-of-validation — `error.param` первой попытки часто ≠ root cause. После фикса первого gap'а вылезает следующий (например cascade-staleness). Один snapshot скрывает прогрессию.

## Решение

`zond api annotate dump --seed-bodies --with-last-attempt --history N` возвращает последние N attempts (newest first) в `attempt_history` block. `last_attempt` остаётся как most-recent для back-compat. Реализовано через `getRecentFixturePosts(pattern, limit)` в src/db/queries/results.ts.

## Acceptance Criteria

- `--history N` принимает положительный integer; `--history 1` эквивалентно отсутствию флага
- `attempt_history` сортируется newest-first
- DB lookup best-effort (миссинг/locked DB → degraded dump со stderr warning, exit 0)
- Тестами покрыт newest-first order и `limit <= 0` → empty array

## Status

Done — commit (ARV-278/279/280/281/282 batch).
<!-- SECTION:DESCRIPTION:END -->

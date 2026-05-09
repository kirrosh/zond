---
id: m-14
title: "dx-papercuts-and-cleanup"
---

## Description

Сборная свалка для всех уцелевших открытых задач после закрытия m-13
(спринты 0+1 из `strategy/audit-and-consolidation.md`). В основном —
DX-papercuts, мелкие баги, низкоприоритетные follow-up'ы старых
майлстоунов (m-3, m-8, m-9, m-10, m-12), которые не успели уехать в
свои треки до консолидации CLI.

Цель: разгрести этот хвост одной волной, прежде чем заходить в Vector-2
(depth/fuzz/SARIF/BOLA — будущий m-15).

## Состав

Категории (см. backlog/tasks/task-* с `milestone: m-14`):

- **stdout/stderr дисциплина** — TASK-241, ранее TASK-236 (archived).
  Машинно-читаемые потоки не должны замусориваться warning'ами.
- **Coverage UX** — TASK-250 (run_id в --json), TASK-251 (default
  union/session), TASK-254 (регрессия 94→89 после регенерации), TASK-41
  (needs-id suites сообщение).
- **generate/runner баги** — TASK-219 (--force/--overwrite),
  TASK-218 (summary path-params без examples), TASK-239 (Next steps
  ×N), TASK-240 (suite-naming inconsistency), TASK-234 (мусор в
  Skipped reason), TASK-260 (chain detector — headless chains).
- **probe DX** — TASK-150 (probe-mass-assignment --retry-inconclusive),
  TASK-154 (probe-security digest payload + run-cmd), TASK-160
  (probe-suites DRY: extends/template), TASK-112 (raw-body/text-body
  для content-type probes).
- **request/diagnose nicety** — TASK-133 (--json-path), TASK-134
  (унификация --json), TASK-266 (db diagnose без аргумента).
- **clean/workspace гигиена** — TASK-258 (clean --api X --force тихо
  сносит probes/), TASK-248 (workspace resolve undefined-warnings).
- **docs/UX** — TASK-265 (CLI QoL bundle: run --watch/--quiet, doctor
  --fix, clean --probes-only), TASK-267 (zond --help группировка по
  фазам + discoverability $randomSlug/Email/Url), TASK-269 (generator
  --explain per-field source).
- **redact / tests** — TASK-171 (redact: миграция existing artifacts),
  TASK-204 (transforms.ts/expr-eval.ts edge cases), TASK-208 (tests
  cleanup).

## Не входит

- Vector-2 (SARIF, `zond checks`, `zond fuzz`, auto-shrinker, BOLA,
  chain-coverage, новые скиллы security/regression/adopt/fuzz) —
  отдельный m-15.
- Разбиение `zond.md` skill на navigator + audit + fixtures — m-15
  (вместе с новыми скиллами).

## Done-критерий

`bunx backlog task list --plain` не содержит ни одной открытой задачи
вне m-14 (или вне Done). После закрытия m-14 — открыть m-15
(vector-2).

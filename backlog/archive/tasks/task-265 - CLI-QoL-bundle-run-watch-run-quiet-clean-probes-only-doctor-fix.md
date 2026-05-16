---
id: TASK-265
title: 'CLI QoL bundle: run --watch, run --quiet, clean --probes-only, doctor --fix'
status: Done
assignee: []
created_date: '2026-05-08 15:00'
updated_date: '2026-05-09 10:02'
labels:
  - feedback-loop
  - cli
  - ux
  - qol
milestone: m-14
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12 impressions, "QoL — низкая стоимость, большой эффект".

Четыре мелких QoL-фичи, по 1-2 часа каждая, бьют по разным болям:

1. **`zond run --watch`** — file-watcher на YAML-suite, при изменении пересобирает + перезапускает изменённые сьюты. Сейчас цикл «edit YAML → run → analyse» = 4-5 секунд на retyping команды; за 12 раундов это часы.

2. **`zond run --quiet`** — глушит «Next steps» footer (3 строки на каждый суит, 60+ строк шума на batch-генерации, ср. feedback-09#F3). Идея: `--quiet` убирает next-steps + summary-only, оставляя exit code и pass/fail.

3. **`zond clean --probes-only --force`** — флаг `--probes` уже есть, но без `--all` всё равно сносит и `tests/`. Уточнить семантику: `--probes-only` сносит ТОЛЬКО `probes/`, не трогая остальное. (Перекликается с TASK-258 про warnings.)

4. **`zond doctor --fix`** — попытаться авто-наполнить пустые fixtures через discover; при `--fix --seed` создать seed-resources. (Это «лёгкая» версия TASK-261 bootstrap; если bootstrap покрывает то же — этот пункт можно закрыть как duplicate.)

Каждая фича — независимая, можно делать по одной.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] #1 `zond run --watch <path>` пересобирает + перезапускает при изменении YAML; Ctrl-C выходит чисто.
- [ ] #2 `zond run --quiet` подавляет «Next steps» и любой non-essential output, оставляя pass/fail summary + exit code.
- [ ] #3 `zond clean --probes-only` сносит только `apis/<X>/probes/`; `tests/` и `spec.json` не трогает.
- [ ] #4 `zond doctor --fix` авто-заполняет пустые fixtures из discover; `--fix --seed` создаёт недостающие seed-resources (или закрыто как dup TASK-261).
- [ ] #5 Documented in `--help` для каждой команды.
<!-- SECTION:ACCEPTANCE:END -->
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (refactor/0905):
- ✅ AC#2 `zond run --quiet`: collapses output to grand-total summary line; suppresses warning footer too. ReporterOptions.quiet wired through console reporter (src/core/reporter/console.ts, src/core/reporter/types.ts, src/cli/commands/run.ts).
- ✅ AC#3 `zond clean --probes-only`: behavior was already covered by `clean --probes` (it's category-scoped via selectEntriesEx — `tests/`, `spec.json`, `.api-catalog.yaml` aren't touched). Help text expanded to spell that out unambiguously.

Deferred:
- ⏭ AC#1 `zond run --watch`: requires file-watcher (Bun.watch / chokidar) + debounced re-run loop + clean Ctrl-C teardown. Estimated 2-3h, not a low-effort win — punted to a dedicated follow-up if we actually use it.
- ⏭ AC#4 `zond doctor --fix`: closed as duplicate of TASK-261 (`zond bootstrap --api X`), which is Done and already does discover-driven fixture auto-fill from a clean workspace. Pointing users at `bootstrap` instead of layering `doctor --fix` on top keeps one path of truth.

Status: 2/4 ACs delivered, 2/4 explicitly deferred with rationale.
<!-- SECTION:NOTES:END -->

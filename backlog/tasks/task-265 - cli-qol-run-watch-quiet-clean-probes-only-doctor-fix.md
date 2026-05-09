---
id: TASK-265
title: 'CLI QoL bundle: run --watch, run --quiet, clean --probes-only, doctor --fix'
status: To Do
assignee: []
created_date: '2026-05-08 15:00'
labels:
  - feedback-loop
  - cli
  - ux
  - qol
dependencies: []
milestone: m-14
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

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] `zond run --watch <path>` пересобирает + перезапускает при изменении YAML; Ctrl-C выходит чисто.
- [ ] `zond run --quiet` подавляет «Next steps» и любой non-essential output, оставляя pass/fail summary + exit code.
- [ ] `zond clean --probes-only` сносит только `apis/<X>/probes/`; `tests/` и `spec.json` не трогает.
- [ ] `zond doctor --fix` авто-заполняет пустые fixtures из discover; `--fix --seed` создаёт недостающие seed-resources (или закрыто как dup TASK-261).
- [ ] Documented in `--help` для каждой команды.
<!-- SECTION:ACCEPTANCE:END -->

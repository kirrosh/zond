---
id: TASK-271
title: 'bootstrap --apply --seed: непрозрачный вывод — что пробовали, что не получилось, сколько пасов'
status: To Do
assignee: []
created_date: '2026-05-08 18:00'
labels:
  - feedback-loop
  - api-sentry
  - bootstrap
  - ux
dependencies:
  - task-261
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-13#F3, class ux-papercut.

В сессии fixtures были уже наполнены, и `zond bootstrap --apply --seed` де-факто ничего не сделал. Но из вывода нельзя понять, **пытался ли он что-нибудь засидить и где остановился**:

- `Filled 4/6 path-FK vars (67%)` — какие 4 заполнены? Какие 2 не получилось и почему?
- `Pass 1: 0 new fixture(s)` — а сколько пасов всего было? Почему остановились?
- В drу-run-режиме (без `--apply`) тот же вывод — непонятно, плановый он или реальный.

Impact: пользователь не знает, где встрять руками (например, дать seed для конкретной FK), и не отличает «всё хорошо» от «ничего не пробовали».

Expected:
- список FK-ключей с их статусом (`already_set`, `discovered`, `seeded`, `failed: <reason>`);
- общее число пасов и причина остановки (`stable`, `no-progress`, `max-passes`);
- explicit no-op summary, если все fixtures уже заполнены: `bootstrap: nothing to do — 35/35 fixtures present`;
- в `--dry-run` помечать каждое действие как plan vs executed.

Actual: краткие проценты без декомпозиции, no-op неотличим от successful run.

Связано: TASK-261 (bootstrap one-shot), TASK-269 (generator --explain per-field source).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] Bootstrap печатает таблицу/список FK с per-key статусом (`already`, `discovered`, `seeded`, `failed:reason`).
- [ ] Summary line содержит N пасов и причину остановки.
- [ ] No-op случай (`Filled X/X`) явно помечен как `nothing to do` + не вводит в заблуждение «1 pass, 0 new».
- [ ] `--dry-run` vs `--apply` визуально различимы (prefix `[plan]` vs `[exec]` или явный header).
<!-- SECTION:ACCEPTANCE:END -->

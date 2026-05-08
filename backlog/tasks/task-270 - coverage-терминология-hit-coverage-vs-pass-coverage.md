---
id: TASK-270
title: 'coverage: терминологическая путаница — одно слово, две метрики (hit-coverage vs pass-coverage)'
status: To Do
assignee: []
created_date: '2026-05-08 18:00'
labels:
  - feedback-loop
  - api-sentry
  - coverage
  - ux
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-13#F2, class ux-papercut.

«Coverage» в выводе zond называется одним словом, считается двумя несовместимыми способами:

- одиночный `zond run` → coverage = «passing 2xx hits на endpoint» (строгая семантика);
- `zond coverage --union session` → coverage = «endpoint hit at all» (свободная семантика — учитываются и passing-2xx, и 5xx, и failed-assertion hits).

Пример конкретного раунда: `Coverage: 200/219 (91%)` в session-union включает 67 passing-2xx + 17 5xx + 75 failed-assertion. При этом в JSON `uncovered: 0`, хотя в одиночном run-е был 6. Без чтения исходников нельзя понять, что метрика поменяла семантику.

Impact: пользователь читает «91%» и не знает, насколько это «реально работает» vs «endpoint просто получил запрос». Появляются jq-хаки для перепроверки.

Expected: либо две разные цифры/колонки (`hit: X/Y`, `pass: A/B`), либо явный label режима в первой строке вывода (`Coverage (any-hit, union session)` vs `Coverage (passing 2xx, single run)`), либо `--mode hit|pass` флаг с дефолтом и упоминанием в `--help`.

Actual: одно число, одна семантика на 2 контекста, без подсказок.

Связано: TASK-242 (static YAML scan vs run results), TASK-251/255 (default vs union).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] `zond coverage` печатает обе метрики раздельно либо явно лейблит активный режим (`hit-coverage` / `pass-coverage`).
- [ ] `zond coverage --help` объясняет разницу одной строкой на каждый режим.
- [ ] JSON envelope несёт `hit_coverage`/`pass_coverage` отдельными полями (или `mode` enum), чтобы CI-агрегаторы не путались.
- [ ] Regression: одиночный run и `--union session` на одном датасете не дают противоречивых `uncovered` без explanation.
<!-- SECTION:ACCEPTANCE:END -->

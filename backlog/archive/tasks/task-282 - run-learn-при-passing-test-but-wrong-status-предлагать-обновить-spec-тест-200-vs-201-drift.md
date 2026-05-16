---
id: TASK-282
title: >-
  run --learn: при passing-test-but-wrong-status предлагать обновить spec/тест
  (200 vs 201 drift)
status: Done
assignee: []
created_date: '2026-05-08 19:00'
updated_date: '2026-05-08 13:33'
labels:
  - feedback-loop
  - api-sentry
  - run
  - schema-drift
  - high-leverage
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-14 «Что было проще руками», class missing-feature.

Schema drift на статус-кодах — частый кейс: spec говорит 201, server возвращает 200; тест с `expect.status: 201` падает; copy-paste 4-5 раз для каждого endpoint надоедает. Идея — opt-in флаг `--learn`, который:
1. По итогам run'а собирает кейсы «status-code mismatch + body+headers OK по схеме» (т.е. функционально пройден, не схватил deeper bug).
2. Предлагает diff'ом обновить либо тест (`expect.status: 200`), либо spec (если spec на диске и редактируется), либо вынести в `tolerated-drifts.yaml` per-API.
3. `--learn` без `--apply` — только показывает план, требует подтверждения.

Связь:
- TASK-275 (negative-by-id) уже использует `expect.status: [404, 400]` toleratorсо schema drift — те же кейсы.
- TASK-249 (validate yaml) — про parse-time, здесь — про run-time learn.

Пример вывода:
```
Drift detected (3 cases):
  POST /user-feedback/   spec=201  observed=200  body-schema=ok  → suggest: update test, or add to drifts
  POST /sessions/        spec=201  observed=200  body-schema=ok  → suggest: update test
  POST /scim/v2/Users/   spec=201  observed=200  body-schema=ok  → suggest: update test
Run with --learn --apply --target=test     to rewrite expect.status in YAML
Run with --learn --apply --target=drifts   to record in apis/sentry/tolerated-drifts.yaml
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] #1 `zond run --learn` опт-ин флаг; без него поведение неизменно.
- [ ] #2 Detector ловит «status mismatch + body matches schema» (т.е. функциональный success при code drift). Чисто status-only mismatches без schema-validation не предлагать (риск маскировки реального бага).
- [ ] #3 `--learn` без `--apply` — печатает план + diff; не пишет в файлы.
- [ ] #4 `--learn --apply --target=test` — точечно правит `expect.status` в YAML-сьютe; `--target=drifts` — запись в `apis/<name>/tolerated-drifts.yaml` (формат TBD, минимум `endpoint, method, expected, observed`).
- [ ] #5 Регрессионный тест: fixture-run с 200/201 drift → план содержит правильный suggest; `--apply --target=test` мутирует YAML, повторный run → 0 drifts.
- [ ] #6 ZOND.md: секция «Learning from drifts» с примером и предупреждением «не использовать на untrusted target».
<!-- SECTION:ACCEPTANCE:END -->
<!-- AC:END -->

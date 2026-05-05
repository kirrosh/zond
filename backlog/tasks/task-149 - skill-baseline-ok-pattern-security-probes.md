---
id: TASK-149
title: 'skill: baseline-OK pattern в security-probe шаблонах'
status: To Do
assignee: []
labels:
  - skill
  - docs
  - probe-security
milestone: m-8
dependencies:
  - TASK-138
priority: medium
---

## Description

## Контекст

Источник: [m-8 feedback §F раунд 2](../notes/m-8-audit-cli-gaps/feedback-original.md).

В Sentry-аудите SSRF-probe на `POST /sentry-apps/` дал 5 × 404 на одной
строке `must reject` — endpoint попросту был недоступен с этим scope'ом.
0 информации, 5 ложных fail. Этот паттерн уже есть в
`probe-mass-assignment` (baseline-INCONCLUSIVE), но в скилле для
security-probes — отсутствует.

После реализации `zond probe-security` (TASK-138) baseline-OK будет
встроен в команду. Но скилл всё равно должен явно описать паттерн —
как минимум для тех случаев, когда пользователь пишет ручной YAML.

## Что сделать

В Phase 5.2/5.3 скилла:

1. Добавить шаблон «baseline-OK first»: послать полностью валидный body,
   проверить, что он бы создал ресурс (или хотя бы доходит до validator —
   400 на конкретном поле, а не 401/403/404 на endpoint в целом).
2. Если baseline сам отдаёт 4xx по auth/route — пометить весь suite
   `SKIPPED-INCONCLUSIVE` с причиной, не проводить атаку.
3. Сослаться на `zond probe-security` (TASK-138) как на встроенную
   реализацию этого паттерна.

## Acceptance Criteria

- [ ] Phase 5.2/5.3 содержит секцию «Baseline-OK first» с YAML-примером.
- [ ] Описаны критерии «когда SKIPPED, когда продолжать атаку».
- [ ] Ссылка на `zond probe-security` (после TASK-138).

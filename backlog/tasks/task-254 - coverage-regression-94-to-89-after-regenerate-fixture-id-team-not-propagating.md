---
id: TASK-254
title: 'coverage: лёгкая регрессия 94→89 после регенерации (suite-rename + team-fixture не доходит)'
status: To Do
assignee: []
created_date: '2026-05-08 14:00'
labels:
  - feedback-loop
  - api-sentry
  - coverage
  - quirk
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-11#F4, class quirk.

После регенерации тестов на новом бинарнике coverage упал с 94/219 (43%) до 89/219 (41%). 41% всё ещё высоко, но факт регрессии стоит зафиксировать.

Repro:
```
zond run apis/sentry/tests --validate-schema --spec ... 
zond coverage --api sentry
# 89/219, было 94/219 в раунде 10
```

Гипотезы (нужно подтвердить):
- На регенерации некоторые suite переименовались (TASK-240 fix про smoke-tag.yaml имена) и часть прежних passed-runs теперь идут в другой suite, без union истории.
- `crud-teams.yaml` появился (TASK-246), но ID-fixture для team не дошёл до зависимых steps → chain ломается раньше.
- Возможно пересечение с TASK-251 (coverage default не union).

Log: /tmp/zond-fb/sentry/rounds/raw-11.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] Найти причину: diff suite-имён round-10 vs round-11 + diff списка passed steps.
- [ ] Если root cause = renaming → mapping/union по operationId, не по suite-имени.
- [ ] Если root cause = team-fixture не доходит → починить chain detector (возможно расширение TASK-246).
- [ ] Verify: после фикса coverage ≥ round-10 (94/219).
<!-- SECTION:ACCEPTANCE:END -->

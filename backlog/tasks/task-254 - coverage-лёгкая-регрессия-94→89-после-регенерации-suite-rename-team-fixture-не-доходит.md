---
id: TASK-254
title: >-
  coverage: лёгкая регрессия 94→89 после регенерации (suite-rename +
  team-fixture не доходит)
status: Done
assignee: []
created_date: '2026-05-08 14:00'
updated_date: '2026-05-09 09:46'
labels:
  - feedback-loop
  - api-sentry
  - coverage
  - quirk
milestone: m-14
dependencies: []
priority: medium
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
<!-- AC:BEGIN -->
<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] #1 Найти причину: diff suite-имён round-10 vs round-11 + diff списка passed steps.
- [ ] #2 Если root cause = renaming → mapping/union по operationId, не по suite-имени.
- [ ] #3 Если root cause = team-fixture не доходит → починить chain detector (возможно расширение TASK-246).
- [ ] #4 Verify: после фикса coverage ≥ round-10 (94/219).
<!-- SECTION:ACCEPTANCE:END -->
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit (refactor/0905):
- Coverage engine keyed по `METHOD path` (src/core/coverage/reasons.ts:87 endpointKey, line 53 MatrixRow.endpoint), suite-имя в покрытие НЕ входит. Гипотеза #1 (rename ломает union) — отклонена: rename suites невозможно влияет на coverage. AC#2 → не нужен.
- Остаётся гипотеза #2: team-fixture не доходит до зависимых steps в crud-teams.yaml → 5 endpoint'ов стали non-2xx. Это не coverage-баг, а fixture/chain-detection регрессия (overlap с TASK-246 и TASK-260).
- Для AC#1/#4 нужны sentry-артефакты + новый round feedback-loop'а. Без них verify невозможен. Reassign to feedback-tester loop.
<!-- SECTION:NOTES:END -->

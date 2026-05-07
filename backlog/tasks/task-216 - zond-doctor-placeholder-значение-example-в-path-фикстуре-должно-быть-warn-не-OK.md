---
id: TASK-216
title: >-
  zond doctor: placeholder-значение example в path-фикстуре должно быть warn, не
  OK
status: Done
assignee: []
created_date: '2026-05-07 14:21'
updated_date: '2026-05-07 14:34'
labels:
  - feedback-loop
  - api-resend
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F8, class likely_bug
Repro: zond doctor --api resend -> '✓ email_id example [path]'
Expected: placeholder-литерал 'example' (или любая не-UUID/ULID/числовая строка в path-поле) -> ⚠ + пометка 'placeholder'
Actual: ✓ означает 'переменная задана' без проверки семантики. Пользователь думает что фикстуры готовы
Log: /tmp/zond-fb/resend/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->

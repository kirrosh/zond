---
id: ARV-143
title: >-
  prepare-fixtures --refresh ignores user-filled vars without read-by-id
  endpoint (no verify feedback)
status: To Do
assignee: []
created_date: '2026-05-12 07:40'
labels:
  - bug
  - prepare-fixtures
  - ux
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sentry round-02: в .env.yaml вручную выставлены owner='pe-koshelev-kirill', repository='zond-test', environment='production'. Refresh не попытался их verify'нуть (в .api-resources.yaml нет read-by-id endpoint'а для этих vars) И не упомянул их в выводе. Пользователь думает что vars не существуют. Параллельно doctor с filled value показывает set:true — несоответствие. Источник: feedback-02 F12; расширение F7 из round-01 на refresh-pass.

Нужна классификация в refresh output: 'user-config / no verify path' — отдельная секция, явно говорит 'не могу verify, доверяю user input'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 refresh summary имеет секцию 'no-verify-path (trusted user input)' с counts
- [ ] #2 manifest var с user-config source ИЛИ без discover-strategy не считается UNSET в refresh summary, если value не пустое
- [ ] #3 doctor и refresh согласованы в классификации этих vars
<!-- AC:END -->

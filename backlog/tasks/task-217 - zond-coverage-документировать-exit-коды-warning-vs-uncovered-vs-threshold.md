---
id: TASK-217
title: 'zond coverage: документировать exit-коды (warning vs uncovered vs threshold)'
status: To Do
assignee: []
created_date: '2026-05-07 14:21'
labels:
  - feedback-loop
  - api-resend
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F9, class quirk (intentional но не документировано)
Repro: zond coverage --spec apis/resend/spec.json --tests apis/resend/tests -> 79/83 (95%) -> EXIT=1
Expected: помощь команды и ZOND.md объясняют exit-коды. Если exit 1 = 'есть uncovered' — ОК для CI с явной документацией. Если exit 1 от warnings — некорректно (CI упадёт на 95% покрытии без причины)
Actual: exit 1, причина не документирована, пользователь не знает CI-семантику
Log: /tmp/zond-fb/resend/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->

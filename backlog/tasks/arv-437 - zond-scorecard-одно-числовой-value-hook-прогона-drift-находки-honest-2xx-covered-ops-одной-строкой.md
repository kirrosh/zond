---
id: ARV-437
title: >-
  zond scorecard: одно-числовой value-hook прогона (drift-находки + honest-2xx +
  covered ops одной строкой)
status: To Do
assignee: []
created_date: '2026-07-13 10:28'
labels:
  - product-led
  - distribution
  - candidate
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Урок из rtk-teardown (backlog/docs/rtk-growth-teardown.md, факт #2): rtk удерживал пользователей командой gain — осязаемым 'сколько ты сэкономил'. У zond есть coverage/report, но нет одной строки-результата прогона: '<N> drift-находок · <X>% honest-2xx · <M>/<T> ops за <t>'. Детерминированно (агрегат уже посчитанных артефактов) → ложится в литмус, идёт в zond. Не суждение о severity — просто сводка. Кандидат post-m-28, product-led дистрибуция. Проверить: не дублирует ли report-bundle/coverage --summary.
<!-- SECTION:DESCRIPTION:END -->

---
id: ARV-437
title: >-
  zond scorecard: одно-числовой value-hook прогона (drift-находки + honest-2xx +
  covered ops одной строкой)
status: Done
assignee: []
created_date: '2026-07-13 10:28'
updated_date: '2026-07-13 11:14'
labels:
  - product-led
  - distribution
  - m-29
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Урок из rtk-teardown (backlog/docs/rtk-growth-teardown.md, факт #2): rtk удерживал пользователей командой gain — осязаемым 'сколько ты сэкономил'. У zond есть coverage/report, но нет одной строки-результата прогона: '<N> drift-находок · <X>% honest-2xx · <M>/<T> ops за <t>'. Детерминированно (агрегат уже посчитанных артефактов) → ложится в литмус, идёт в zond. Не суждение о severity — просто сводка. Кандидат post-m-28, product-led дистрибуция. Проверить: не дублирует ли report-bundle/coverage --summary.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано 2026-07-13. core/coverage/scorecard.ts (чистый computeScorecard над матрицей+runs) + cli/commands/scorecard.ts (--api/--session/--json), зарегистрирован в Analyze. Детерминированный агрегат персистентных прогонов, без HTTP. findings=классифицированные failure_class результаты; depth-check findings без severity не считаются (потолок задокументирован в коде+скилле). Тесты: tests/core/coverage/scorecard.test.ts (6). Contract-allow-lists обновлены. Bonus: добавлено отсутствовавшее зеркало skills/zond/SKILL.md. Проверено вживую на github/stripe/sentry/vercel.
<!-- SECTION:NOTES:END -->

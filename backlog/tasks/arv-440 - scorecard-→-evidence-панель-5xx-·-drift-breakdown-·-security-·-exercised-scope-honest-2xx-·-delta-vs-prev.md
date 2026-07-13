---
id: ARV-440
title: >-
  scorecard → evidence-панель: 5xx · drift-breakdown · security ·
  exercised-scope honest-2xx · delta vs prev
status: Done
assignee: []
created_date: '2026-07-13 11:21'
updated_date: '2026-07-13 11:45'
labels:
  - m-29
  - scorecard
  - distribution
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Расширение ARV-437 после persist-findings (ARV-439). Текущая карточка слаба/вводит в заблуждение: 0 findings (depth-check не персистятся), honest-2xx в самом злом знаменателе (4% vs 80% exercised в кейсах). Довести до детерминированной evidence-панели, НА которой агент строит оценку API (грейд остаётся агенту — litmus): (1) 5xx count — единственный judgment-free health-сигнал, заголовок всех кейсов; (2) drift breakdown из persisted check findings (N status-drift · M schema); (3) security probe outcome (blocked/inconclusive/finding); (4) honest-2xx в exercised-scope ИЛИ оба (80% exercised · 4% full-surface); (5) delta vs предыдущий прогон (+K drift since last) — gain-подобное ощущение повторной ценности. Зависит от ARV-439.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано 2026-07-13. computeScorecard расширен в evidence-панель: serverErrors (5xx из матрицы, judgment-free), findings по as-emitted severity + byCategory (из check_findings ARV-439), suiteFailures (failure_class, отдельно), honest-2xx exercised+full, delta vs прошлый скан (getPreviousScanFindingCount). formatScorecardLine дропает нулевые сегменты. Тесты: tests/core/coverage/scorecard.test.ts (6). Проверено вживую: github → '0 5xx · 21 findings · 2 high · 6 med · 13 low · 50%/0% honest-2xx · +21 vs prev', delta на повторе -4. Грейд остаётся агенту (litmus). Оговорка: security probe outcome пока не в панели (probe findings не в check_findings) — отдельный источник, follow-up при необходимости.
<!-- SECTION:NOTES:END -->

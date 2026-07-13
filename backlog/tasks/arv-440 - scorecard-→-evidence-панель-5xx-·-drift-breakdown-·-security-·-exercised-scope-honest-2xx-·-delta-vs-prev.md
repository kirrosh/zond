---
id: ARV-440
title: >-
  scorecard → evidence-панель: 5xx · drift-breakdown · security ·
  exercised-scope honest-2xx · delta vs prev
status: To Do
assignee: []
created_date: '2026-07-13 11:21'
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

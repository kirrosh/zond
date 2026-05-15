---
id: ARV-250
title: >-
  pivot: severity matrix overhaul — no CRITICAL without end-to-end proof, HIGH
  requires evidence-chain
status: To Do
assignee: []
created_date: '2026-05-15 07:03'
labels:
  - m-21
  - pivot
  - severity
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

R18 GitHub-прогон показал: текущая severity-матрица инфлирует HIGH/CRITICAL на пробах без proven impact. Зонд позиционируется как API hygiene scanner для небольших команд (НЕ bug bounty tool — это территория Burp/Caido). Принцип: no evidence → no high severity.

## Цель

Зафиксировать severity-матрицу, основанную на доказанном impact, а не на факте аномалии. Отсутствие CRITICAL в отчёте — не баг, это feature честного отчёта.

## Не покрывает

Перезаписи самих проб (evidence-chain в mass-assignment / CRLF) — отдельные задачи в этом же пивоте.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CRITICAL emitted ТОЛЬКО когда зонд собрал end-to-end exploit-цепочку (прочитал данные другого юзера / выполнил действие без auth / прочитал файл). Без цепочки CRITICAL вообще не выпускается.
- [ ] #2 HIGH требует evidence-chain хотя бы из 2 запросов (storage + reflection / authz endpoint 200 без токена / persistence confirmed via follow-up GET). Без proof — потолок LOW.
- [ ] #3 MEDIUM = sane defaults нарушены (5xx, schema drift, отсутствие rate limit, открытый CORS на sensitive). Не security per se, но fix-worthy.
- [ ] #4 LOW = hygiene без proof (санитизация не сделана но reflection не найден, SSRF accept без proof of delivery, inconsistent status codes).
- [ ] #5 INFO = статика спеки, стилистика, mass-assignment-no-effect, всё что 'could be intentional'.
- [ ] #6 Все существующие пробы пройдены и severity пересчитан под новую матрицу; regression-test фиксирует ожидаемый severity per probe-class.
<!-- AC:END -->

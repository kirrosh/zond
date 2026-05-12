---
id: ARV-140
title: >-
  probe security: cleanup-feasibility pre-flight (skip POSTs without DELETE
  counterpart unless --allow-leaks)
status: Done
assignee: []
created_date: '2026-05-12 07:39'
updated_date: '2026-05-12 08:03'
labels:
  - bug
  - probe
  - cleanup
  - prod-safety
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sentry round-01/02 fb-loop: probe security атакует POST endpoint'ы у которых нет DELETE counterpart в spec → ресурс остаётся в prod-org навсегда (через CLI убрать невозможно, только через UI). После двух rounds — 18 manual-cleanup записей в orphan tracker, каждый последующий round наслаивает новые. Источник: feedback-02 F6 + feedback-01 F6.

Конкретные пострадавшие endpoints в Sentry: POST /teams/, POST /symbol-sources/, POST /user-feedback/, POST /keys/ — все без DELETE counterpart. Ресурсы вида 'zond-safe\\r\\nX-Zond-Injected: yes' / 'aqoereaf' остаются. Часть из них — CRLF-injected names (что само по себе HIGH-severity finding из probe).

Нужен pre-flight pass: для каждого target POST проверить через .api-resources.yaml — есть ли DELETE /X/{id}? Если нет AND нет state-save (PUT-snapshot rollback) — endpoint исключается из атак ИЛИ требуется явный --allow-leaks/--no-cleanup чтобы продолжить. Аналог уже есть в probe security для partial-PUT через --isolated (TASK-264), расширить на POST-без-DELETE.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 probe security строит cleanup-feasibility map по spec до запуска атак
- [ ] #2 POST без DELETE counterpart исключается из target list (skip с reason='no-delete-counterpart')
- [ ] #3 --allow-leaks/--no-cleanup флаг возвращает старое поведение (явный opt-in)
- [ ] #4 summary digest показывает 'X endpoints skipped (no cleanup path)'
<!-- AC:END -->

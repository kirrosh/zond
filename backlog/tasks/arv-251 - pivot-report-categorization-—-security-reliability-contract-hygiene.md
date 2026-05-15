---
id: ARV-251
title: 'pivot: report categorization — security / reliability / contract / hygiene'
status: To Do
assignee: []
created_date: '2026-05-15 07:03'
labels:
  - m-21
  - pivot
  - reporting
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Сейчас отчёт смешивает security findings, reliability bugs, contract drift и spec-lint в одну плоскую кучу с инфлированной severity. Для FE/QA-команды маленькой компании это паралич: 132 HIGH = "ничего непонятно, выкидываем".

## Цель

Чёткая категоризация. Каждый класс пробы помечен своей категорией; отчёт показывает per-category roll-up. Это решает 70% критики "категориальная путаница" без переписывания проб.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Отчёт (HTML / NDJSON / SARIF) разделён на 4 категории: security, reliability, contract, hygiene.
- [ ] #2 5xx-on-valid-input перенесён из security в reliability (MEDIUM).
- [ ] #3 Schema drift / status-code inconsistency перенесены в contract (MEDIUM).
- [ ] #4 Spec-lint (additionalProperties, examples, style) → hygiene (INFO/LOW массово); см. отдельную задачу про zond lint mode.
- [ ] #5 Маленькая команда видит сводку '0 security, 12 reliability, 40 contract, 200 hygiene' и понимает с чего начинать.
- [ ] #6 Skills (zond-checks.md, zond-base.md) обновлены под новые категории.
<!-- AC:END -->

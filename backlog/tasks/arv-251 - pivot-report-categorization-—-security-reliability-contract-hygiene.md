---
id: ARV-251
title: 'pivot: report categorization — security / reliability / contract / hygiene'
status: Done
assignee: []
created_date: '2026-05-15 07:03'
updated_date: '2026-05-15 08:12'
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
- [x] #1 Отчёт (HTML / NDJSON / SARIF) разделён на 4 категории: security, reliability, contract, hygiene.
- [x] #2 5xx-on-valid-input перенесён из security в reliability (MEDIUM).
- [x] #3 Schema drift / status-code inconsistency перенесены в contract (MEDIUM).
- [x] #4 Spec-lint (additionalProperties, examples, style) → hygiene (INFO/LOW массово); см. отдельную задачу про zond lint mode.
- [x] #5 Маленькая команда видит сводку '0 security, 12 reliability, 40 contract, 200 hygiene' и понимает с чего начинать.
- [x] #6 Skills (zond-checks.md, zond-base.md) обновлены под новые категории.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Category taxonomy shipped at src/core/severity/category.ts: 4 categories (security/reliability/contract/hygiene), CATEGORY_BY_ID map covering all registered checks + probe classes. CheckFinding.category optional field; runner stamps it via categoryFor(check) at emission. CheckRunSummary.by_category bucket; runner increments alongside by_severity. Reclassifications: 5xx (not_a_server_error) → reliability; conformance/data-rejection → contract; m-20 cross-resource probes → contract; auth/injection probes → security. SARIF ruleId format unchanged (<category>-<check_id>) but category prefixes now reflect new taxonomy. CLI checks reporter emits per-category roll-up line. JSON schemas regenerated. Regression test at tests/core/category-taxonomy.test.ts locks taxonomy + per-id assignments (7 tests).
<!-- SECTION:FINAL_SUMMARY:END -->

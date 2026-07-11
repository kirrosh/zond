---
id: ARV-434
title: >-
  annotate: express multi-step / ordered create in seed_bodies (create B then A
  referencing B)
status: Done
assignee: []
created_date: '2026-07-11 07:43'
updated_date: '2026-07-11 09:09'
labels:
  - m-28
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stripe deep-dive (m-28): correct invoice lifecycle needs 'create invoice (draft), THEN create invoiceitem with customer+invoice=' — an ordered two-step create within one resource. seed_body overlay is a single create-body per resource; the resource graph is FK-based (child→parent), not action-ordered, so this ordering can only live in a hand-written scenario, not in annotate. Lower priority (scenarios cover it) but the overlay gap is real. Litmus: ordering rule is deterministic once authored → zond; which bodies = agent.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано (commit 07e45a6): seed_body.setup — упорядоченные post-create POST'ы, выполняются после главного create и до первого lifecycle-действия. {{id}} = id созданного ресурса; резолвятся path-фикстуры ({{customer}}, {{account_currency}}) и capture'ы предыдущих шагов. Non-2xx setup-шаг → skip с конкретным step+status (ресурс не готов, не баг). Litmus-split соблюдён: агент пишет тела+порядок (суждение), zond исполняет по порядку (детерминизм). Потребитель — lifecycle_transitions (мотивирующий invoice-кейс: create invoice(draft) → setup POST invoiceitem(invoice={{id}}) → finalize). Кейс 'create B then A referencing B' где B обычный FK-родитель остаётся на fkDependencies + prepare-fixtures (не дублируем). Тесты: 2 новых (setup включает тест + setup-failure→skip), 2475 pass. Документировано в скилле zond-checks (setup + пример invoice).
<!-- SECTION:NOTES:END -->

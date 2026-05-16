---
id: ARV-194
title: 'API zoo expansion: добавить ≥2 публичных API (Linear/GitHub/Shopify) в apis/'
status: Done
assignee: []
created_date: '2026-05-13 19:19'
updated_date: '2026-05-15 07:03'
labels:
  - m-21
  - api-zoo
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Personal-token auth, permissive seed. Прогнать m-20 probes, зафиксировать findings — без этого probes валидируются только на враждебном Stripe.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Минимум 2 новых API в apis/: на выбор Linear, GitHub, Shopify
- [ ] #2 Каждый API: spec.json + .env.yaml + .api-resources.yaml + .api-resources.local.yaml (annotated seed_body/readback)
- [ ] #3 prepare-fixtures даёт ≥80% path-FK fill на каждом
- [ ] #4 Все 5 m-20 probes (cross_call, idempotency, pagination, lifecycle, webhooks) прогнаны; findings и PASS зафиксированы в backlog/notes/m-21-validation.md
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Закрыто после R18-итерации (тест на GitHub API, 2026-05-15). GitHub-прогон m-20 probes дал стратегический сигнал большей ценности, чем findings: текущий severity-дизайн зонда инфлирует HIGH/CRITICAL на пробах без evidence-chain (CRLF без reflection, SSRF без OOB, mass-assignment без follow-up GET). Дальнейшее расширение зоопарка (Linear/Shopify) бесполезно до пивота severity-матрицы и категоризации отчёта. См. новые задачи под m-21: severity matrix overhaul, evidence-chain probe rewrites, report categorization (security/reliability/contract/hygiene). Linear/Shopify будут добавлены позже как regression-validation новой матрицы, отдельной задачей.
<!-- SECTION:FINAL_SUMMARY:END -->

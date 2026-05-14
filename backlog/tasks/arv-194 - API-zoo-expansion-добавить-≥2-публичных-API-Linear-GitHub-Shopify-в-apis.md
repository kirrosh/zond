---
id: ARV-194
title: 'API zoo expansion: добавить ≥2 публичных API (Linear/GitHub/Shopify) в apis/'
status: To Do
assignee: []
created_date: '2026-05-13 19:19'
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

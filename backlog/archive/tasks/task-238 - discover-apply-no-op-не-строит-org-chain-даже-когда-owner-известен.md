---
id: TASK-238
title: 'discover --apply no-op: не строит org-chain даже когда owner известен'
status: Done
assignee: []
created_date: '2026-05-08 08:36'
updated_date: '2026-05-08 08:40'
labels:
  - feedback-loop
  - api-sentry
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback rounds 02 F3 (deferred), 06 F2 (reconfirm), class definitely_bug
Repro: organization_id_or_slug='pe-koshelev-kirill' в .env.yaml; zond discover --api sentry --apply
Expected: discover дёргает GET /api/0/organizations/{org}/projects/, /teams/, /members/, /repos/ и пишет первый id/slug в .env.yaml
Actual: 'No path-FK dependencies with known owner resources — nothing to discover.' — не понимает что organization_id_or_slug уже заполнен и может быть owner
Impact: 32+ INCONCLUSIVE-BASE в probe security, 58 в mass-assignment — всё из-за пустых FK
Log: /tmp/zond-fb/sentry/rounds/raw-06.log (=== discover --apply ===)
Note: TASK-136 (Done) реализовал команду, но логика owner-detection broken
<!-- SECTION:DESCRIPTION:END -->

---
id: ARV-148
title: >-
  prepare-fixtures --apply --cascade: HTTP engine ignores
  .env.yaml/.secrets.yaml auth → 100% 401
status: Done
assignee: []
created_date: '2026-05-12 09:11'
updated_date: '2026-05-12 09:15'
labels:
  - feedback-loop
  - api-stripe
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F3, class definitely_bug

Repro:
zond add api stripe --spec /tmp/stripe-spec.json --force
echo 'auth_token: sk_test_...' >> apis/stripe/.secrets.yaml
zond prepare-fixtures --api stripe --apply --cascade --seed

Expected: list/seed requests send Authorization: Bearer <auth_token> from .secrets.yaml, 200 OK on list endpoints, IDs harvested into .env.yaml
Actual: all GET/POST requests return 401; raw log shows 'failed:miss-status' for all 98 vars. Same auth_token used by zond request works (200).

Contrast: zond request --api stripe GET /v1/customers → 200. zond checks run --api stripe → also 200 (uses ARV-61 auto-attach). prepare-fixtures HTTP engine is the only one not loading auth.

Log: $HANDOFF/rounds/raw-02.log:1-60
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause same as ARV-147 in parallel runtime function liveAuthHeaders. Two-pass walk applied in src/core/probe/shared.ts:358. Tests in tests/core/probe/live-auth-headers.test.ts (5 scenarios). Commit a496062. Side-effect: also fixes path-discovery and mass-assignment-probe runtime auth-header construction.
<!-- SECTION:NOTES:END -->

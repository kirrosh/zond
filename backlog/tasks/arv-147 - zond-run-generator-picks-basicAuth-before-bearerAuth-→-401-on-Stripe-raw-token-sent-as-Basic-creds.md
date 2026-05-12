---
id: ARV-147
title: >-
  zond run: generator picks basicAuth before bearerAuth → 401 on Stripe (raw
  token sent as Basic creds)
status: Done
assignee: []
created_date: '2026-05-12 09:11'
updated_date: '2026-05-12 09:14'
labels:
  - feedback-loop
  - api-stripe
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F5, class definitely_bug

Repro:
zond add api stripe --spec /tmp/stripe-spec.json --force
zond run apis/stripe/tests --safe --report json

Expected: tests send Authorization: Bearer <auth_token> (Stripe spec declares BOTH basicAuth and bearerAuth as http schemes; zond request correctly uses Bearer)
Actual: tests send Authorization: Basic <raw-auth-token>. Stripe base64-decodes it as garbage → 401 (Invalid API Key). 168/168 steps fail.

Root cause hypothesis: generator picks the first security scheme alphabetically/positionally (basicAuth < bearerAuth) instead of preferring bearer over basic when both are declared. zond request uses different selection logic and gets it right.

Inconsistency:
- zond request --api stripe GET /v1/customers → Authorization: Bearer ... → 200
- zond run apis/stripe/tests --safe → Authorization: Basic <raw> → 401

Log: $HANDOFF/rounds/run-safe-02.json
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed by two-pass walk in src/core/probe/shared.ts:getAuthHeaders. Pass 1: bearer/apiKey schemes; pass 2: basic fallback. Tests in tests/core/probe/get-auth-headers.test.ts (6 scenarios) lock in: bearer wins over basic regardless of declaration order, apiKey-via-Authorization wins, basic-only fallback still works. Commit 1094e26.
<!-- SECTION:NOTES:END -->

---
id: ARV-149
title: >-
  zond request: --body always JSON; add --form for
  application/x-www-form-urlencoded (Stripe v1)
status: Done
assignee: []
created_date: '2026-05-12 09:11'
updated_date: '2026-05-12 11:57'
labels:
  - feedback-loop
  - api-stripe
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F4, class missing-feature

Repro:
zond request POST /v1/products --api stripe --body '{"name":"x"}'

Expected: respect requestBody.content from spec (Stripe v1 declares application/x-www-form-urlencoded for all mutating endpoints), or expose --form flag
Actual: 400 'Invalid request (check that your POST content type is application/x-www-form-urlencoded)'. zond always sends Content-Type: application/json regardless of spec.

Effect: cannot seed resources via zond request POST on Stripe-style APIs. Compounds F3 (prepare-fixtures --seed also affected) and F6 (probe mass-assignment skips form bodies).

Spec to follow: Stripe Customers POST → requestBody.content has only application/x-www-form-urlencoded with nested form parameters (email, name, etc.).

Log: $HANDOFF/rounds/raw-02.log (grep 'Invalid request')
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: --form flag on zond request, auto-detection from spec requestBody.content, form: emission in zond generate. Tests in tests/runner/form-encode.test.ts.
<!-- SECTION:NOTES:END -->

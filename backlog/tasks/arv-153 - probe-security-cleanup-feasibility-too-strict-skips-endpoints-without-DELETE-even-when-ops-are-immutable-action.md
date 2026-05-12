---
id: ARV-153
title: >-
  probe security cleanup-feasibility too strict: skips endpoints without DELETE
  even when ops are immutable/action
status: To Do
assignee: []
created_date: '2026-05-12 10:02'
labels:
  - feedback-loop
  - api-stripe
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F7, class ux-papercut+likely_bug

Repro: zond probe security --api stripe ssrf,crlf,open-redirect --include 'path:^/v1/(customers|prices|charges)'
Expected: probe should attack input fields even on endpoints without DELETE counterpart when the operation is semantically safe (POST /v1/charges = immutable financial record; POST /v1/customers/{id}/sources/{src}/verify = action verb; POST .../balance_transactions = ledger append). No 'leak risk'.
Actual: 18/22 endpoints SKIPPED with 'no DELETE counterpart in spec (cleanup-feasibility pre-flight; pass --allow-leaks to override)'.

Root cause hypothesis: hasDeleteCounterpart in cleanup-feasibility looks only for DELETE /resource/{id} in spec, doesn't classify operation semantics (create-resource vs action vs append-immutable).

Workaround: --allow-leaks exists but applies to whole run, not per-endpoint. Doesn't help on Stripe (F6 dominates first).

Log: $HANDOFF/rounds/raw-03.log, apis/stripe/probes/security-digest-03.md
<!-- SECTION:DESCRIPTION:END -->

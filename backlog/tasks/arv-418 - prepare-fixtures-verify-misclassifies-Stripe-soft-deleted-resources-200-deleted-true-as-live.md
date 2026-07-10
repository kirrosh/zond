---
id: ARV-418
title: >-
  prepare-fixtures --verify misclassifies Stripe soft-deleted resources (200 +
  deleted:true) as live
status: Done
assignee: []
created_date: '2026-07-10 12:38'
updated_date: '2026-07-10 13:13'
labels:
  - m-28
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stripe run#3 (m-28). 'zond prepare-fixtures --api stripe --verify' classified the pre-seeded {{customer}} fixture (cus_UVj658w8sGhJxe) as 'verify-live' (200). Manual GET on the same id returns 200 with body {"id":"cus_UVj658w8sGhJxe","object":"customer","deleted":true} — the customer was deleted, but Stripe's GET-by-id for a deleted resource returns HTTP 200 (a stub object with deleted:true), not 404. verify's live/stale classifier only branches on HTTP status (2xx -> live, 404 -> stale — see the same pattern in fixtures.ts addAction validate block), so it never inspects the body for a soft-delete marker. This let a genuinely dead fixture silently poison a large chunk of this run (~15+ probe/CRUD baselines chained off {{customer}} failed with 'No such customer' before the fixture was manually caught and replaced). Deterministic fix candidate: when the read-by-id response schema declares (or the live body contains) a boolean 'deleted' field set true, classify as stale even on HTTP 200 — this is a common REST soft-delete convention (Stripe, and others) and detectable without judgment: either from the declared response schema (oneOf full-resource / deleted-stub) or a body-level check for a top-level 'deleted: true' field alongside the object's declared 'object'/'id'. Evidence: apis/stripe/.env.yaml history, zond-runs/stripe-run3-20260710/raw/03-prepare-fixtures-verify.json (customer -> verify-live), manual repro 'zond request GET /v1/customers/cus_UVj658w8sGhJxe --api stripe' (200, deleted:true).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed the philosophy-safe way: NOT a growing vendor-marker list. Added one shared isSoftDeletedBody() (top-level deleted:true) proven by Stripe run#3 — used by both prepare-fixtures --verify (discover.ts) and fixtures add --validate. Verified live: cus_UVj658w8sGhJxe → [stale 200] soft-deleted (was live). Comment forbids growing markers speculatively per Evidence-over-inference.
<!-- SECTION:NOTES:END -->

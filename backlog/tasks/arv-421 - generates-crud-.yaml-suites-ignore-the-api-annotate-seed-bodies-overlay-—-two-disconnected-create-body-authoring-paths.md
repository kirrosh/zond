---
id: ARV-421
title: >-
  generate's crud-*.yaml suites ignore the api annotate --seed-bodies overlay —
  two disconnected create-body authoring paths
status: Done
assignee: []
created_date: '2026-07-10 12:39'
updated_date: '2026-07-10 13:13'
labels:
  - m-28
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stripe run#3 (m-28), form-encoded money-endpoint depth pass. Authored a 7-resource seed_body overlay via 'zond api annotate dump/apply --seed-bodies' (charges, customers, invoices, payment_intents, payouts, quotes, refunds) specifically so form-encoded creates would succeed. Confirmed the overlay IS consumed by 'probe mass-assignment' (baseline 200 on POST /v1/charges using the seed_body) and by 'checks run --check stateful' (cross_call_references/ensure_resource_availability create-chains, all 200 after fixture fixes). It is NOT consumed by 'zond generate's crud-*.yaml suites — those use generate's own typed-random generator ({{}}/{{}}), which produces nonsensical bodies for format-strict form-encoded fields (card[number]: a random string instead of a Luhn-valid PAN, customer: a random string instead of a real id) and reliably 400s on every one of the 7 resources (verified: 7/7 crud-*.yaml POST steps failed with 400, see raw/60-diagnose-crud-raw.json). This matches the skill's own documented scope ('--seed-bodies ... feeds into: all stateful checks (create-body overlay)' — generate is not listed), so this may be working as designed, not a bug — filing as a low-priority consistency/DX gap: the operator does real work authoring a correct create-body once, then generate's own suites (the most 'default'/discoverable path for exercising CRUD) still 400 on the very same resource, with no cross-reference or hint pointing at the overlay that would fix it. Deterministic candidate: have 'zond generate' prefer an existing .api-resources.local.yaml seed_body over its own typed generator when one is present for a resource (same overlay, same file, already parsed elsewhere in the codebase) — purely a data-source substitution, no new judgment. Evidence: apis/stripe/.api-resources.local.yaml (seed_body block), apis/stripe/tests/crud-charges.yaml (POST body uses {{}} for card[number] etc.), zond-runs/stripe-run3-20260710/raw/60-diagnose-crud-raw.json (7/7 400s).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Declined as by-design (YAGNI), no code change. generate.ts does not load resourceConfigs at all — threading the seed_body overlay into the generator is a new feature, not a bug fix. The task itself notes 'may be working as designed'; the skill docs scope --seed-bodies to stateful checks only. The two paths serve different purposes: generate = smoke/CRUD scaffolding for zond run; seed_body = depth-check create-bodies. An operator authoring seed_body is in the depth-check flow, where it IS consumed (verified: mass-assignment + cross_call_references use it). Reopen under a real need if generate-smoke CRUD coverage on form-strict APIs becomes a priority.
<!-- SECTION:NOTES:END -->

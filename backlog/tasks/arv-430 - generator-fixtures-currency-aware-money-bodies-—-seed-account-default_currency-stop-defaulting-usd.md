---
id: ARV-430
title: >-
  generator/fixtures: currency-aware money bodies — seed account
  default_currency, stop defaulting usd
status: To Do
assignee: []
created_date: '2026-07-11 07:43'
updated_date: '2026-07-11 08:02'
labels:
  - m-28
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stripe deep-dive (m-28): account default currency is EUR; generated create-bodies default currency=usd → invoiceitem 400s on currency-conflict → invoice stays $0 → finalize jumps straight to 'paid', masking the entire open→pay→void lifecycle. zond has no notion of account default currency. Fix: harvest account_currency fixture from GET /v1/account.default_currency (or equivalent), inject into money-body generators / seed_bodies. Deterministic → zond. Highest-value finding of the run.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 account_currency fixture auto-seeded from account endpoint when spec has one
- [ ] #2 money-body generator uses account_currency instead of hardcoded usd
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RECLASSIFIED after litmus review: not a clean deterministic zond fix. Clean impl (currency→{{currency}} fixture with USD default) needs 3-site generator change + new fixture source + design call (which currency fields, required-or-not, shared var vs per-field FX-directional) with cross-API blast radius on generator's always-valid property. Per litmus, fixture-invention leans agent-side. Shipped instead: skill-doc practice in zond.md (non-USD account money bodies — read account.default_currency before seeding, $0-finalizes-instantly is the tell). Left open as scoped design task, NOT quick fix. Deterministic core (currency field→overridable fixture) can revisit if a second corpus API exercises it.
<!-- SECTION:NOTES:END -->

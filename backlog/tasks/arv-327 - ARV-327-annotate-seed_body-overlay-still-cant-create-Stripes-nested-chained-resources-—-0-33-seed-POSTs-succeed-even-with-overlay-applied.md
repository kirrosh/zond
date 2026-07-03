---
id: ARV-327
title: >-
  ARV-327: annotate seed_body overlay still can't create Stripe's nested/chained
  resources — 0/33 seed POSTs succeed even with overlay applied
status: Done
assignee: []
created_date: '2026-07-03 08:25'
updated_date: '2026-07-03 10:12'
labels:
  - prepare-fixtures
  - annotate
  - seed-body
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on Stripe zond-audit run 20260703-103831, AFTER fixing the zond-audit workflow's step order so annotate --auto-apply runs before prepare-fixtures --seed (confirmed working: raw/02-fixtures.log now shows [overlay] tags on 4 seed attempts -- card, payout, topup, financial_account -- proving the seed_body overlay IS being read this time, unlike the pre-fix run). Despite that, 0/33 seed POST attempts still succeeded (0%), including all 4 overlay-covered ones (still 400). Root cause per report-zond.md F1: the overlay only fills fields inferable from the spec/heuristics in isolation (amount/currency/type-shaped defaults) -- it can't supply nested cross-resource fields that require a FK chain of their own, e.g. issuing 'cards' needs a parent cardholder/customer id, 'financial_account' needs a 'capabilities' object with specific sub-keys. Since prepare-fixtures runs resources in one pass, resources needing an as-yet-uncreated parent can't be seeded even in principle, regardless of overlay quality. Downstream impact: only 43% of path-FK vars filled, entire accounts/{account}/* and most customers/{customer}/* nested sub-trees stayed uncovered (see F1/F2 in report-zond.md), and mass-assignment probe coverage collapsed to 18/291 suites (272 INCONCLUSIVE on baseline-POST failure, same root cause). Fix ideas: (a) topologically order seed attempts by FK dependency depth so parents are created before children within the same --cascade pass, and/or (b) extend annotate's seed-bodies heuristic to recognize 'needs a same-run-created parent id' as a distinct required-field class (not just spec-shape defaults) and wire it to the freshly-created ids from earlier passes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 prepare-fixtures --seed creates parent resources before attempting child resources that reference them within the same cascade run
- [ ] #2 at least the 4 currently overlay-covered resources (card, payout, topup, financial_account) succeed end-to-end on a live Stripe test-mode account, or the remaining blocker is documented per-resource in the overlay
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed: topological seed ordering + body-FK precheck defer (bootstrap.ts). Live-verified on Stripe: seed success 0/33-34 -> 1/67, external_account_id/person now defer cleanly instead of wasting live POSTs. Root blocker for the rest of the tree is a separate content-quality gap (accounts has zero seed_body overlay) -- filed as ARV-329.
<!-- SECTION:NOTES:END -->

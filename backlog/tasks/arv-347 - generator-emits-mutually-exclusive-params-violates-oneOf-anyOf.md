---
id: ARV-347
title: generator emits mutually-exclusive params (violates oneOf/anyOf)
status: To Do
assignee: []
created_date: '2026-07-06 13:03'
labels:
  - zond-bug
  - generator
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: live Stripe audit 2026-07-06 (run 20260706-150730). data-factory emits POST bodies with multiple members of a oneOf/mutual-exclusion group -> server 400s. Example: POST /v1/identity/verification_sessions -> 400 "You may only specify one of these parameters: related_customer, related_customer_account". This single generator defect drives the BULK of 1294 positive_data_acceptance + 165 run 400s — i.e. tool-side noise inflating the API report.

LITMUS: pure deterministic generator-correctness (honor oneOf/anyOf, pick exactly one branch) -> belongs in zond. Highest-leverage tool-quality fix: cuts the #1 noise source in every report.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 data-factory honors oneOf/anyOf: never emits >1 member of a mutual-exclusion group
- [ ] #2 positive_data_acceptance noise on Stripe drops materially
<!-- AC:END -->

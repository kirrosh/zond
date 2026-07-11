---
id: ARV-434
title: >-
  annotate: express multi-step / ordered create in seed_bodies (create B then A
  referencing B)
status: To Do
assignee: []
created_date: '2026-07-11 07:43'
labels:
  - m-28
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stripe deep-dive (m-28): correct invoice lifecycle needs 'create invoice (draft), THEN create invoiceitem with customer+invoice=' — an ordered two-step create within one resource. seed_body overlay is a single create-body per resource; the resource graph is FK-based (child→parent), not action-ordered, so this ordering can only live in a hand-written scenario, not in annotate. Lower priority (scenarios cover it) but the overlay gap is real. Litmus: ordering rule is deterministic once authored → zond; which bodies = agent.
<!-- SECTION:DESCRIPTION:END -->

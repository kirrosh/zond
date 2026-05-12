---
id: ARV-150
title: >-
  probe mass-assignment: skips form-urlencoded requestBody, only looks at
  application/json
status: To Do
assignee: []
created_date: '2026-05-12 09:11'
labels:
  - feedback-loop
  - api-stripe
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F6, class missing-feature

Repro:
zond probe mass-assignment --api stripe --emit-tests ... --output ...

Expected: probe iterates mutating endpoints whose requestBody declares application/x-www-form-urlencoded (Stripe's universal pattern) and constructs form-encoded probe payloads
Actual: SKIPPED (265) — 'no JSON request body' for ALL Stripe endpoints. Probe filters on requestBody.content[application/json]; Stripe declares only application/x-www-form-urlencoded.

Digest example: 'HIGH 0 · INCONCLUSIVE 0 · ... · SKIPPED 265' across mass-assignment-digest.md

Tied to ARV-149 (zond request --form): once form-encoded body construction lands as a reusable helper, probe mass-assignment should adopt it.

Log: apis/stripe/probes/mass-assignment-digest.md
<!-- SECTION:DESCRIPTION:END -->

---
id: ARV-198
title: >-
  probe mass-assignment --emit-template: auto form-encoded body for form-only
  APIs (F15)
status: To Do
assignee: []
created_date: '2026-05-14 08:09'
labels:
  - feedback-loop
  - api-stripe
  - m-21
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 07, finding F15, class ux-papercut.

Repro:
  zond probe mass-assignment --api stripe --emit-template 'POST:/v1/customers' --output ma.yaml

Expected: when spec requestBody declares application/x-www-form-urlencoded, emit-template should emit a 'form:' block with Content-Type header and string-quoted booleans/numbers — not 'json:'.

Actual: always emits 'json:' block. For Stripe-style form-only APIs the user must run a node post-processing script to: (1) add Content-Type: application/x-www-form-urlencoded header, (2) rename json: → form:, (3) quote booleans/numbers/null as strings inside the form: block only.

Workaround (proven): /tmp/convert-ma-templates-v3.js with 3 patches. Manual conversion ran on 15 endpoints in R07.

Log: $HANDOFF/rounds/raw-07.log
<!-- SECTION:DESCRIPTION:END -->

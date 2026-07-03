---
id: ARV-198
title: >-
  probe mass-assignment --emit-template: auto form-encoded body for form-only
  APIs (F15)
status: Done
assignee: []
created_date: '2026-05-14 08:09'
updated_date: '2026-05-17 05:54'
labels:
  - feedback-loop
  - api-stripe
  - m-21
  - polish-m-22
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done 2026-05-17 (polish-m-22 batch-3 / Tier 3): mass-assignment-template detects requestBodyContentType=application/x-www-form-urlencoded and emits form: block + Content-Type header instead of json:. Both buildFullChain (POST→GET→DELETE) and buildSingleStep (orphan PUT) paths covered. Stripe v1 / Rails / PHP-style mutators no longer need the node post-processing patch on 15+ endpoints. Serializer's ARV-162 force-quote keeps booleans/numbers as wire-strings.
<!-- SECTION:NOTES:END -->

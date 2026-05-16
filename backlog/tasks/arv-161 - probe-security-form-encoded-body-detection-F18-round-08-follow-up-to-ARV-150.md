---
id: ARV-161
title: >-
  probe security: form-encoded body detection (F18 / round-08 follow-up to
  ARV-150)
status: Done
assignee: []
created_date: '2026-05-12 12:19'
updated_date: '2026-05-12 12:25'
labels:
  - feedback-loop
  - api-stripe
  - m-16
  - form-encoding
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 08, finding F18, class likely_bug (incomplete F6 fix).

Repro: zond probe security --api stripe ssrf,crlf,open-redirect --include 'path:^/v1/(customers|charges|payment_links)'

Expected: on endpoints with form-encoded requestBody (Stripe v1 pattern), security probe walks the form schema fields the same way mass-assignment now does (ARV-150) — detects url/string-format fields by name and probes them with SSRF/CRLF/open-redirect payloads.
Actual: 'skipped: no JSON request body' for POST /v1/customers, /v1/charges, /v1/payment_links, /v1/accounts. mass-assignment sees these endpoints; security still filters on requestBody.content[application/json].

Effect: SSRF/CRLF/open-redirect probes unreachable on 78+ Stripe POST endpoints with user-controlled URL fields (webhook url, return_url, customer description).

Fix: replace hasJsonBody(ep) gate in security-probe.ts (~line 285) and security-probe-class.ts (~line 58) with hasProbeBody from probe-harness.ts; serialise attack body via serializeProbeBody so form-encoded endpoints get x-www-form-urlencoded payloads.

Log: ~/Projects/zond-test/.fb-loop/rounds/raw-08.log
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: security-probe now uses hasProbeBody/buildBodyAuthHeaders/serializeProbeBody (parity with mass-assignment ARV-150). Form-encoded endpoints get x-www-form-urlencoded payloads on baseline/per-attack/restore-PUT paths. Test: tests/core/probe/security-probe-form-body.test.ts.
<!-- SECTION:NOTES:END -->

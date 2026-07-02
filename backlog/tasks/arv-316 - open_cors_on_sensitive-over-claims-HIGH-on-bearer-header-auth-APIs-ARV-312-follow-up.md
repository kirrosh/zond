---
id: ARV-316
title: >-
  open_cors_on_sensitive over-claims HIGH on bearer/header-auth APIs (ARV-312
  follow-up)
status: To Do
assignee: []
created_date: '2026-07-02 15:18'
labels:
  - severity
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live Stripe run 20260702-174915: after ARV-312 (2xx gating), 117 open_cors findings remain HIGH on status:200. But Stripe authenticates via Authorization: Bearer, not cookies — a cross-origin browser fetch cannot attach the victim's secret, so reflected-Origin + Allow-Credentials:true is NOT exploitable as 'any attacker site can read authed responses'. Allow-Credentials only matters with an AMBIENT credential (cookie/session/basic). Gate the HIGH 'read authed responses' claim on evidence of cookie/session auth (Set-Cookie observed, or securityScheme type apiKey-in-cookie / http-basic); for pure bearer/token APIs cap at LOW (hygiene, not exploitable). Complements ARV-312's status gate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 open_cors caps at LOW when the endpoint's auth is bearer/header token (no ambient browser credential)
- [ ] #2 HIGH retained only with cookie/session/basic auth evidence
- [ ] #3 regression: bearer-auth 2xx reflection → LOW; cookie-auth 2xx reflection → HIGH
<!-- AC:END -->

---
id: ARV-212
title: >-
  generate: emit Authorization header in suites when .env.yaml has auth_token
  (R13/F16)
status: Done
assignee: []
created_date: '2026-05-14 09:25'
updated_date: '2026-05-14 09:31'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 13, finding F16, class likely_bug / missing-feature, severity HIGH.

Repro:
  zond add api gh2 --spec api.github.com.json
  # .env.yaml has 'auth_token: "@secret:auth_token"' (ARV-201 fix)
  zond generate --api gh2 --output apis/gh2/tests --tag Meta
  head -10 apis/gh2/tests/smoke-meta-positive.yaml
  # → no 'headers:' block, no Authorization

Expected: when .env.yaml.auth_token is set (regardless of spec components.securitySchemes), generator should emit
  headers:
    Authorization: 'Bearer {{auth_token}}'
in the suite top-level — mirroring the auto-attach that zond request --api X / runner already perform for ad-hoc requests.

Actual: generator only consults spec.components.securitySchemes. For specs without schemes (GitHub) the suite has no auth header — every step goes unauth, hits the 60/hour GitHub rate limit after ~60 steps, and bricks the round.

Impact: HIGH — all generated suites on GitHub-style specs are functionally unauth-only despite ARV-201 fix wiring auth_token end-to-end elsewhere.

Log: see feedback-13.md F16.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed: suite-generator's getSuiteHeaders now falls back to {Authorization: 'Bearer {{<defaultAuthVar>}}'} when securitySchemes is empty AND generate.ts passed defaultAuthVar (set when .env.yaml carries auth_token). generate.ts probes envForWarnings for auth_token presence (not value — empty placeholder is OK; once .secrets.yaml is filled the suite picks up the value at runtime). Verified end-to-end: generated GitHub Meta suite now has top-level 'headers: { Authorization: "Bearer {{auth_token}}" }'. Regression tests added in tests/generator/suite-generator.test.ts.
<!-- SECTION:NOTES:END -->

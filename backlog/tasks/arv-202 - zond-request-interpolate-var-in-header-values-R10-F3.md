---
id: ARV-202
title: 'zond request: interpolate {{var}} in --header values (R10/F3)'
status: Done
assignee: []
created_date: '2026-05-14 08:11'
updated_date: '2026-05-17 05:44'
labels:
  - feedback-loop
  - api-github
  - m-21
  - polish-m-22
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 10, finding F3, class likely_bug / ux-papercut, severity MEDIUM.

Repro:
  zond request GET /user --api github \
    --header 'Authorization: Bearer {{auth_token}}'
  # → 401, header reaches the server literally as 'Bearer {{auth_token}}'

Expected: --header values should interpolate {{var}} from .env.yaml/.secrets.yaml/.identity.yaml the same way the body of tests and the URL in ad-hoc requests do.

Actual: header passed verbatim. This removes the only safe workaround for F2 (raw token in --header is forbidden by iron rule).

Log: see feedback-10.md F3.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
round-11: F2 fix (ARV-201) practically resolves F3 — after .env.yaml auto-seeds auth_token: @secret:auth_token, vars carries auth_token and substituteDeep already-implemented at send-request.ts:134 interpolates the --header correctly. The 'header passes literally' symptom only happens when auth_token is not in vars at all. The deeper question (should --header substitution fall back to .secrets.yaml even without .env.yaml wiring?) remains, but is no longer a github-user blocker. Reclassify: keep open as low-priority polish.

Done 2026-05-17 (polish-m-22 batch-2 / request): not-a-bug as of ARV-201 — substituteDeep at send-request.ts:143 already interpolates {{var}} in --header values once auth_token is in vars (auto-seeded by ARV-201). Deeper auto-fallback into .secrets.yaml is intentionally out-of-scope (leak risk, .env.yaml is the contract).
<!-- SECTION:NOTES:END -->

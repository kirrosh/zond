---
id: ARV-218
title: >-
  probe + live calls: inject auth_token Bearer when spec has no securitySchemes
  (R15/F25)
status: Done
assignee: []
created_date: '2026-05-14 10:08'
updated_date: '2026-05-14 10:08'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 15, finding F25, class likely_bug, severity HIGH.

Repro:
  zond probe mass-assignment --api github --include 'path:^/user$' --emit-tests /tmp/ma --output /tmp/ma-digest.md
  # → baseline 401 'Requires authentication' (token IS filled in .secrets.yaml — verified via zond request GET /rate_limit returning 5000/h)

Expected: live probes (mass-assignment, security, path-discovery) attach Authorization: Bearer <auth_token> even when ep.security is empty (bare specs without components.securitySchemes — GitHub). This mirrors what zond request --api X already does in resolveAdHocRequest and what ARV-212 made the generator emit at suite level.

Actual: liveAuthHeaders short-circuits to {} when ep.security.length===0, leaving the baseline POST unauth — INCONCLUSIVE-BASE ×1, all 7 outcomes=unknown.

Fix: in liveAuthHeaders (src/core/probe/shared.ts), when ep.security is empty AND schemes is empty AND vars.auth_token is non-empty, return {Authorization: 'Bearer <token>'}.

Log: see feedback-15.md F25 + apis/github/probes/mass-assignment-r15-digest.md.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in src/core/probe/shared.ts liveAuthHeaders: when ep.security=[] AND schemes=[] AND vars.auth_token!='', return {Authorization: 'Bearer <token>'}. Mirrors ARV-212's suite-level fallback into the live-probe code path (mass-assignment, security, path-discovery).
<!-- SECTION:NOTES:END -->

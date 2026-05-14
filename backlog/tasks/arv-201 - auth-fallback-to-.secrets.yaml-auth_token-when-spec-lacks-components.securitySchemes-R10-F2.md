---
id: ARV-201
title: >-
  auth: fallback to .secrets.yaml auth_token when spec lacks
  components.securitySchemes (R10/F2)
status: Done
assignee: []
created_date: '2026-05-14 08:11'
updated_date: '2026-05-14 08:24'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 10, finding F2, class missing-feature / likely_bug, severity HIGH.

Repro:
  zond add api github
  zond doctor --api github --json | jq '.data.fixtures.required[].name' | grep -i auth
  # nothing — auth_token is NOT listed as required
  zond request GET /user --api github
  # → status 401 'Requires authentication' (token from .secrets.yaml NOT attached)

Expected:
  (1) zond add api / refresh-api detects empty components.securitySchemes + .secrets.yaml.auth_token present, adds auth_token to manifest with source: auth-fallback and shows doctor warning 'no securityScheme in spec — falling back to Authorization: Bearer'.
  OR
  (2) .secrets.yaml.auth_token + --api <name> always attaches Authorization: Bearer <token> by default (Postman-style) with a first-run warn log.

Actual: GitHub's official OpenAPI ships with components.securitySchemes = null, .security = null, per-path .security = null. zond silently does NOT include auth_token in the manifest, does NOT attach the header, and doctor doesn't hint anything. Only workaround: hand-edit .api-resources.local.yaml (undocumented in SKILL.md for this purpose).

Impact: HIGH — all 'bare' specs without securitySchemes (github, internal APIs) cannot be run live without manual hack.

Log: see feedback-10.md F2.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed: setup-api.ts now seeds 'auth_token: "@secret:auth_token"' into .env.yaml when authVarNames=[] (i.e., spec has no components.securitySchemes). Mirrors the existing .secrets.yaml fallback. Regression test in tests/cli/doctor.test.ts. Bare GitHub-style specs now get Authorization: Bearer attached on zond request --api X without manual .env.yaml editing. Verified: zond request GET /user --api github will pick up auth_token after user fills .secrets.yaml.
<!-- SECTION:NOTES:END -->

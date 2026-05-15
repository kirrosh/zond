---
id: ARV-209
title: >-
  zond run --validate-schema: auto-resolve spec from --api / current-api
  (R12/F11)
status: Done
assignee: []
created_date: '2026-05-14 08:26'
updated_date: '2026-05-14 08:28'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 12, finding F11, class missing-feature, severity MEDIUM.

Repro:
  zond use github
  zond run apis/github/tests/_smoke_user.yaml --validate-schema
  # → Error: --validate-schema requires --spec <path|url> or a collection with openapi_spec set

Expected: with current-api set (or --api passed), --validate-schema should resolve apis/<name>/spec.json automatically, mirroring how zond request --api X auto-picks the spec. Alternatively the error should reference --api / current-api explicitly so users know they have to add --spec apis/<name>/spec.json.

Actual: hard error referencing only --spec/openapi_spec. Skill DEPTH-PASS prompt says 'zond run apis/<name>/tests --validate-schema' — does not work; users have to append --spec apis/<name>/spec.json every time.

Impact: friction in every DEPTH-PASS run; breaks SKILL.md example commands verbatim.

Log: see feedback-12.md F11.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed: run.ts spec-resolution now also extracts apiName from test paths matching 'apis/<name>/tests/...' and falls back to resolveApiCollection + on-disk apis/<name>/spec.json. Also improved error message to mention --api / apis/<name>/spec.json hint. Verified: zond run apis/github/tests/_smoke_user.yaml --validate-schema now works without explicit --spec.
<!-- SECTION:NOTES:END -->

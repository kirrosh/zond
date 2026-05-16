---
id: ARV-61
title: >-
  checks run --api: auto-attach Bearer/api-key auth from .env.yaml in
  depth-checks requests
status: Done
assignee: []
created_date: '2026-05-11 06:50'
updated_date: '2026-05-11 06:53'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F1, class definitely_bug. Repro: zond checks run --api resend --rate-limit auto --ndjson > out.ndjson. Expected: per --help, --auth-header should be auto-derived from apis/<name>/.env.yaml (auth_token, api_key) when --api is set; depth-check requests should go under Bearer token. Actual: all 154 cases sent without Authorization header; all 83 findings are spurious 'status_code_conformance: 401 not declared'; 8 of 12 checks effectively dead. Impact: depth-audit unusable for any API with auth (95% of real APIs). Log: ~/Projects/zond-test/.fb-loop/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Response-phase probe requests (positive, negative_data, coverage boundaries, unsupported_method) carry the authHeaders that runChecks() receives
- [x] #2 case-specific request headers are not overwritten by authHeaders (case-insensitive)
- [x] #3 missing_required_header probe does not re-inject the very header it is intentionally dropping
- [x] #4 regression test mocks a Bun server and asserts the Bearer token is present on every probe request
<!-- AC:END -->

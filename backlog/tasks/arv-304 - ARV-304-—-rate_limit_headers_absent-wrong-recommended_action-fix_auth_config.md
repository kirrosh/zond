---
id: ARV-304
title: >-
  ARV-304 — rate_limit_headers_absent: wrong recommended_action
  (fix_auth_config)
status: Done
assignee: []
created_date: '2026-05-18 15:26'
updated_date: '2026-07-03 16:02'
labels:
  - bug
  - zond-side
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bug: finding `rate_limit_headers_absent` LOW stamps recommended_action=`fix_auth_config`, which is wrong — this is a server-side hygiene gap (no X-RateLimit-* / RateLimit-* / Retry-After on a 2xx mutating endpoint), nothing to do with caller auth config. Likely `tighten_validation` (backend contract gap) or `report_backend_bug`. Found 2026-05-18 on live Stripe scan, 9× LOW findings on POST /v1/charges/{id}, POST /v1/checkout/sessions/{id}, etc.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 rate_limit_headers_absent finding uses an enum that an agent can route on as a backend-side issue, not as a caller-side fix
- [x] #2 test covers the per-finding recommended_action mapping
<!-- AC:END -->

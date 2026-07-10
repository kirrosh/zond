---
id: ARV-371
title: >-
  checks: new check for query params declared optional in spec but actually
  required by server
status: To Do
assignee: []
created_date: '2026-07-08 10:46'
updated_date: '2026-07-10 07:29'
labels:
  - fixtures
  - checks
dependencies: []
references:
  - reports/docgen-api-v30/20260708-131254/report-zond.md#MF3
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CORRECTION (was mis-scoped as a fixture-discovery gap): investigation showed GET /api/questions/v30/answers's questionCode query param has NO required:true in the spec — it's genuinely undeclared-required there, so nothing can 'discover' it as a fixture gap from the spec alone. This is an API spec/implementation drift bug (spec says optional, server 400s without it), same class as positive_data_acceptance findings, NOT a zond fixture-tracking gap. positive_data_acceptance already covers this class for POST/PUT/PATCH bodies but explicitly skips GET (buildCoverageCases returns [] for GET/DELETE) — so no existing check exercises 'declared-optional query params actually required' on GET requests.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Add a new depth-check (e.g. optional_query_param_conformance): for GET operations with declared query params, build two positive-phase requests — (a) all query params populated from schema, (b) only required-per-spec params populated (optional ones omitted). If (a) succeeds (2xx) and (b) 4xx's, emit a MEDIUM finding: 'query param declared optional but empirically required', evidence = both response statuses + the omitted param name(s). Deterministic — no severity/FP judgment, purely comparing two real HTTP responses.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
m-28 Bucket C (evidence-first): промотировать в работу, когда corpus-прогон подтверждает класс проблемы на реальном API; не брать спекулятивно.
<!-- SECTION:NOTES:END -->

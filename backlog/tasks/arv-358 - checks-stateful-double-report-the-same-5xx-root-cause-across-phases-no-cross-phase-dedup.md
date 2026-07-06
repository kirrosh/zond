---
id: ARV-358
title: >-
  checks/stateful double-report the same 5xx root cause across phases (no
  cross-phase dedup)
status: To Do
assignee: []
created_date: '2026-07-06 15:40'
labels:
  - zond-bug
  - checks
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: run 20260706-175930. The GET /v1/billing/alerts cursor-500 HIGH is emitted in BOTH 30-checks.ndjson and 40-stateful.ndjson (cursor_boundary_fuzzing), and not_a_server_error re-reports the same endpoint x2 — a naive HIGH count reads 4 for 1 defect. Triage dedups by hand. LITMUS CAUTION: cross-phase finding dedup edges toward the agent's job (severity/attribution). Deterministic-safe scope: dedup only by exact (check_id, method, path, request_signature) identity key across phase streams — NOT semantic 'same root cause' guessing. If that's still judgment, leave it to triage and instead just document the double-emit so the agent expects it. Opportunistic/low.
<!-- SECTION:DESCRIPTION:END -->

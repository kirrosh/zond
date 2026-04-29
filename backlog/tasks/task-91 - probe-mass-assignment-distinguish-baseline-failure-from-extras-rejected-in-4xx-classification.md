---
id: TASK-91
title: >-
  probe-mass-assignment: distinguish baseline-failure from extras-rejected in
  4xx classification
status: To Do
assignee: []
created_date: '2026-04-29 12:19'
labels:
  - probe
  - follow-up
  - bug-hunting
  - security
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Symptom

When baseline body contains FK fields with random/non-existent UUIDs (`account_id`, `customer_id`, `team_id`, `domain_id`, `project_id`, …), the API returns 4xx (404 Domain not found, 422 Audience not found, …) on FK lookup *before* reaching extras validation. `probe-mass-assignment` currently classifies this as OK — «extras refused» — masking endpoints that may actually silently accept extras.

## Repro

Resend baseline run: POST /api-keys reported as rejected 404 in digest; manual probe without `domain_id` shows endpoint silently accepts injected `is_admin` / `role` / `account_id` and returns 201. Same FK pattern is the dominant shape on Stripe / Linear / GitHub / Resend — anywhere POSTs reference parent resources.

## Impact

False-negative rate scales with the number of FK fields per endpoint. Resend (small surface, 1 endpoint) is barely affected. On SaaS APIs with FK-heavy POSTs, *most* mutating endpoints would land in OK without seeing real extras validation. `--emit-tests` regression suites for those endpoints are doubly bad: each CI run 404`s and the green-shaped failure masks real regressions.

## Fix sketch

Primary: send baseline body (without extras) first. Compare classification:
- baseline 4xx + with-extras 4xx → **INCONCLUSIVE-baseline** (new bucket): baseline itself invalid; surface in separate digest section with hint to set fixture / fix env path-params / verify scope.
- baseline 2xx + with-extras 4xx → **OK** (current behaviour, real validation).
- baseline 2xx + with-extras 2xx → existing applied/ignored/inconclusive flow.
- baseline 4xx + with-extras 2xx → unusual but possible (server treats extras as bypass) — flag as **HIGH**.

Optimisation: cache baseline result per endpoint path, and skip the second baseline call when the with-extras 4xx body matches the cached baseline body byte-for-byte (cheap heuristic for repeated probes).

## Acceptance

- New severity bucket `inconclusive-baseline` rendered in markdown digest with explicit hint (e.g. «baseline POST returned the same 404 — set `domain_id` in env or fix fixture data»).
- `emitRegressionSuites` skips `inconclusive-baseline` (and existing `medium`) — no YAML for endpoints whose baseline is broken.
- Tests: 4xx-on-baseline + 4xx-on-extras → INCONCLUSIVE; 2xx-on-baseline + 4xx-on-extras → OK; 4xx-on-baseline + 2xx-on-extras → HIGH (extras-bypass).
- ZOND.md `probe-mass-assignment` section updated with new bucket + hint about fixtures/path-params.
- Resend baseline re-run: POST /api-keys lands in INCONCLUSIVE with actionable hint instead of false-OK.
<!-- SECTION:DESCRIPTION:END -->

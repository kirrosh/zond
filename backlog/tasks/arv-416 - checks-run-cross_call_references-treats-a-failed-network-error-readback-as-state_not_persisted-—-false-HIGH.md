---
id: ARV-416
title: >-
  checks run: cross_call_references treats a failed (network-error) readback as
  state_not_persisted — false HIGH
status: Done
assignee: []
created_date: '2026-07-10 12:38'
updated_date: '2026-07-10 13:13'
labels:
  - m-28
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stripe run#3 (m-28), form-encoded + money-endpoint depth pass. `checks run --check cross_call_references --live` on POST /v1/customers produced a HIGH finding: '10 state-not-persisted field(s), 3 write-only field(s)' for a freshly-created customer (cus_UrME8ANaDnDA4g), claiming email/name/description/balance/etc were written but not read back. Manually verified FALSE: `zond request GET /v1/customers/cus_UrME8ANaDnDA4g` immediately after returned 200 with every field exactly matching the POST response. The finding's own evidence carries `response_summary.status: 0` — the readback GET hit a transient network error ('socket connection was closed unexpectedly', same intermittent pattern seen elsewhere in this run, ~1% of case volume under checks run against Stripe). The check has a broken-baseline guard on the CREATE side (skips with 'create returned 400/404 — broken-baseline guard') but no equivalent guard on the READ side — a failed/empty read is silently diffed against the write and reported as real drift. Deterministic fix: cross_call_references (and likely other stateful checks with a readback step) should skip with a broken-baseline-style reason when the read call itself errors or returns status 0/5xx, instead of treating missing data as 'not persisted'. Evidence: zond-runs/stripe-run3-20260710/raw/40-checks-stateful.json (finding), raw/40-checks-stateful.stdout.log; manual repro via 'zond request GET /v1/customers/cus_UrME8ANaDnDA4g --api stripe' (200, all fields present).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed: read-side broken-baseline guard in cross_call_references.ts — a 2xx readback yielding an empty/non-object body now skips instead of reporting every echoed field as state-not-persisted. Deterministic (no heuristic), symmetric with the create-side guards. Unit test added (empty-body readback → skip). All tests green; built+installed.
<!-- SECTION:NOTES:END -->

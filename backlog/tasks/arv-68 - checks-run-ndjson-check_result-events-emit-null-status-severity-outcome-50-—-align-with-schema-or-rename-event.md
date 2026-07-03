---
id: ARV-68
title: >-
  checks run ndjson: check_result events emit null status/severity/outcome (50%)
  — align with schema or rename event
status: Done
assignee: []
created_date: '2026-05-11 06:50'
updated_date: '2026-05-18 11:55'
labels:
  - feedback-loop
  - api-resend
  - m-16
  - polish-m-22
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F8, class ux-papercut/likely_bug. Repro: jq 'select(.type=="check_result")' checks-01.ndjson | head — 346/346 events have status/severity/outcome all null. Expected: per docs/json-schema/ndjson-events.schema.json, check_result has status, severity, outcome. Actual: all three fields null in every event; useful signal only in finding-events. Fix: either populate these fields, document that they are null on no-finding outcomes, or rename to check_attempt. Log: ~/Projects/zond-test/.fb-loop/rounds/checks-01.ndjson
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Original baseline: check_result NDJSON event emitted null status/severity/outcome. Resolved через предыдущие m-19 рефакторинги (ARV-215 surfaced severity required enum, добавлен verdict enum pass|fail, status/outcome удалены полностью — теперь event always non-null). Дополнительно в этой сессии: добавил отсутствующее CheckRunSummarySchema.suppressed (ARV-283 emit-side был, schema-side нет — это и ронял tests/cli/checks/ndjson-pipeline.test.ts AC #4). Регенерил docs/json-schema/ndjson-events.schema.json. Все тесты зелёные.
<!-- SECTION:NOTES:END -->

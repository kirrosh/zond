---
id: ARV-68
title: >-
  checks run ndjson: check_result events emit null status/severity/outcome (50%)
  — align with schema or rename event
status: To Do
assignee: []
created_date: '2026-05-11 06:50'
updated_date: '2026-05-16 10:55'
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

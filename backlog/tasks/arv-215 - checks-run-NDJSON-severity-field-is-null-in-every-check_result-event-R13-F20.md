---
id: ARV-215
title: >-
  checks run NDJSON: severity field is null in every check_result event
  (R13/F20)
status: To Do
assignee: []
created_date: '2026-05-14 09:25'
updated_date: '2026-05-16 07:35'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 13, finding F20, class ux-papercut, severity LOW.

Repro:
  zond checks run --api github --report ndjson --include ... > checks.ndjson
  jq -s 'map(select(.type=="check_result"))|group_by(.severity)|map({sev:.[0].severity,n:length})' checks.ndjson
  # → [{"sev":null,"n":2118}]

Expected: each check_result event carries severity from the registry (zond checks list shows [high]/[medium]/[low] per check).

Actual: always null. Forces re-join with zond checks list to group NDJSON by severity.

Log: see feedback-13.md F20.
<!-- SECTION:DESCRIPTION:END -->

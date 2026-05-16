---
id: ARV-83
title: >-
  checks run ndjson: skipped_outcomes uses 'check: reason' colon-joined keys —
  hard to parse
status: To Do
assignee: []
created_date: '2026-05-11 07:34'
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
Source: feedback round 04, finding F26, class ux-papercut. Repro: jq '.summary.skipped_outcomes' v-f2.ndjson → '"response_headers_conformance: no declared response headers": 83'. The reason often contains its own colons, so splitting on ':' is ambiguous. Expected: either a nested object {check, reason, count} or a stable non-colon separator. Log: ~/Projects/zond-test/.fb-loop/rounds/v-f2.ndjson
<!-- SECTION:DESCRIPTION:END -->

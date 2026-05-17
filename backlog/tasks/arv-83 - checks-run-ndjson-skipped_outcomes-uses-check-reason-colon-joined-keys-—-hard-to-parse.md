---
id: ARV-83
title: >-
  checks run ndjson: skipped_outcomes uses 'check: reason' colon-joined keys —
  hard to parse
status: Done
assignee: []
created_date: '2026-05-11 07:34'
updated_date: '2026-05-17 05:44'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done 2026-05-17 (polish-m-22 batch-2 / ndjson): added skipped_outcomes_grouped to CheckRunSummary — Array<{check, reason, count}>, sorted desc. Built once at run end via groupSkippedOutcomes (types.ts). Legacy skipped_outcomes kept for back-compat; schema regenerated. Consumers no longer need to colon-tokenise reasons that contain colons.
<!-- SECTION:NOTES:END -->

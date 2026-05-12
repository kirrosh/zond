---
id: ARV-159
title: >-
  db diagnose: dedupes failures by recommended_action without a count note or
  --no-dedupe flag
status: Done
assignee: []
created_date: '2026-05-12 11:12'
updated_date: '2026-05-12 11:13'
labels:
  - feedback-loop
  - api-stripe
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 05, finding F13, class missing-feature

Repro: zond db diagnose 31 --json
Expected: clear annotation '197 failures grouped into 3 signatures' on each representative, OR a --no-dedupe flag to surface all.
Actual: .data.failures[] contains 3 entries (per recommended_action enum). 194 underlying failures invisible. Risk: same recommended_action can mask distinct root causes (e.g. fix_env = missing auth + missing base_url — different fixes, same enum).
Workaround: zond db run <id> --status 4xx --json | jq — but that's a different command surface.

Minimal fix: add 'underlying_count' int to each representative in --json output, and 'X failures collapsed into N signatures' line in human-readable output.

Log: $HANDOFF/rounds/diagnose-31.json
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added optional group_count field on failure representatives in groupFailures path. Existing .grouped_failures + .by_recommended_action unchanged. Commit 6acc2b1.
<!-- SECTION:NOTES:END -->

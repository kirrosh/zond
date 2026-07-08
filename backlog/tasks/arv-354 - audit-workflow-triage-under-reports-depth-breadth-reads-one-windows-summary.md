---
id: ARV-354
title: >-
  audit workflow: triage under-reports depth breadth (reads one window's
  summary)
status: Done
assignee: []
created_date: '2026-07-06 13:04'
updated_date: '2026-07-06 14:51'
labels:
  - workflow
  - tooling
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: run 20260706-150730. zond-audit windowed the depth-pass into 15 op-windows (ARV-342). The triage stage reported "40 operations depth-checked" / coverage framing from a SINGLE window summary, while the raw NDJSON shows 414 distinct operations actually checked. Under-reports real breadth ~10x.

This is the AUDIT WORKFLOW (.claude/workflows/zond-audit.js triage prompt), not zond core. Fix: triage must AGGREGATE per-window summaries (sum operations / count distinct operation paths from 30-checks.ndjson) instead of reading the last summary line.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 triage reports aggregate distinct operations across all windows, not one window
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
zond-audit.js triage prompt now receives the aggregated depth breadth (covOps coverage-ops + stOps stateful-ops, summed across all ARV-342 windows) with a jq distinct-op fallback, and is told NOT to read operations from a single window summary / 70-coverage.json (~10x under-report).
<!-- SECTION:NOTES:END -->

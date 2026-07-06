---
id: ARV-354
title: >-
  audit workflow: triage under-reports depth breadth (reads one window's
  summary)
status: To Do
assignee: []
created_date: '2026-07-06 13:04'
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

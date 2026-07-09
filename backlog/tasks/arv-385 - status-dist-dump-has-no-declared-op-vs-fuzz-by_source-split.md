---
id: ARV-385
title: status-dist dump has no declared-op vs fuzz (by_source) split
status: Done
assignee: []
created_date: '2026-07-09 11:41'
updated_date: '2026-07-09 11:47'
labels:
  - zond-audit
  - ux
  - reporter
  - wontfix
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From petstore v0.26.0 verify audit (report-zond UX2).

The status histogram (90-status-dist.txt: 500:87, 405:86, ...) is flat — the 87x500 / 86x405 are mostly unsupported_method + boundary fuzz doing their job, not 87 distinct endpoint bugs. A first-time reader over-counts severity; the triage agent must cross-ref the findings ndjson to learn only ~4 declared ops actually 5xx. Add a by_source split (declared-operation vs fuzz/boundary) to the status dump. NOTE: 90-status-dist.txt is currently emitted by the zond-audit workflow script, not zond core — decide whether the split belongs in a zond command (e.g. checks summary) or the workflow dump.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed: not a core task by litmus (src/CLAUDE.md). The declared-op vs fuzz source is already in zond evidence — every response carries run_kind, and coverage already exposes bySource (ARV-265). Splitting "87x500 noise vs 4 real" for readability is triage-presentation the AGENT does from that evidence; building a status-by-source classifier into core would regrow the presentation/heuristic layer m-24 removed. 90-status-dist.txt is a workflow-script artifact, not zond core — at most a trivial workflow-dump tweak using the existing run_kind, tracked here for opportunistic pickup.
<!-- SECTION:NOTES:END -->

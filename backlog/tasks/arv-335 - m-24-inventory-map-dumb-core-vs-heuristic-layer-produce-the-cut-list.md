---
id: ARV-335
title: 'm-24 inventory: map dumb-core vs heuristic-layer, produce the cut list'
status: Done
assignee: []
created_date: '2026-07-06 07:14'
updated_date: '2026-07-06 07:29'
labels:
  - m-24
dependencies: []
documentation:
  - backlog/docs/m24-cut-list.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
First step of m-24 (decision-9). Run a whole-repo audit (ponytail-audit) to classify every module as deterministic dumb-core (send request, validate schema, store run, diff runs) vs autonomous heuristic layer (discovery auto-fill, prepare-fixtures --seed/--cascade auto-create, annotate auto, severity calibrators). Output: a ranked cut list — what to delete, what to keep, what to reshape into an agent-driven tool. Gates the removal tasks below.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Inventory done: 6-agent classification of 52k LOC src/. Deliverable: backlog/docs/m24-cut-list.md (ranked cut-list, TIER1 hard-cut ~2.1k LOC isolated, KEEP-CORE = send/validate/store/diff, mapped to ARV-336/337/338). Heuristic layer ~5-6k LOC, concentrated and isolated.
<!-- SECTION:NOTES:END -->

---
id: ARV-335
title: 'm-24 inventory: map dumb-core vs heuristic-layer, produce the cut list'
status: To Do
assignee: []
created_date: '2026-07-06 07:14'
labels:
  - m-24
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
First step of m-24 (decision-9). Run a whole-repo audit (ponytail-audit) to classify every module as deterministic dumb-core (send request, validate schema, store run, diff runs) vs autonomous heuristic layer (discovery auto-fill, prepare-fixtures --seed/--cascade auto-create, annotate auto, severity calibrators). Output: a ranked cut list — what to delete, what to keep, what to reshape into an agent-driven tool. Gates the removal tasks below.
<!-- SECTION:DESCRIPTION:END -->

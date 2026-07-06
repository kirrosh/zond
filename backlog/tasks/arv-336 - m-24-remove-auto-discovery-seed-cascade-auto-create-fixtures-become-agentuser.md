---
id: ARV-336
title: >-
  m-24 remove auto-discovery + seed/cascade auto-create; fixtures become
  agent+user
status: Done
assignee: []
created_date: '2026-07-06 07:14'
updated_date: '2026-07-06 07:55'
labels:
  - m-24
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per decision-9: the fixture heuristic layer is the top bug source (ARV-334 numeric-id in owner slot; ARV-327/329 1% Stripe seed success). Remove auto-discovery fill and prepare-fixtures --seed/--cascade auto-creation. Replace with: zond reports which fixtures/auth are missing or stale (deterministic), the agent fills them or asks the user for the missing value. No guessing.
<!-- SECTION:DESCRIPTION:END -->

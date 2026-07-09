---
id: ARV-382
title: >-
  prepare-fixtures: emit candidates instead of dead-ending miss-no-list
  (evidence-over-inference)
status: To Do
assignee: []
created_date: '2026-07-09 10:06'
labels:
  - feature
  - generator
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ARV-376 follow-up, class 2 + the META principle. The deeply-nested tail (templateVersionId behind /api/template-version20/{templateVersionId}/markup/textblock/list, textBlockId, etc.) is the long tail no static owner-inferencer will ever fully cover — chasing it with more marker/verb lists is exactly the heuristic creep src/CLAUDE.md warns about. Litmus-correct universal solution: when zond cannot CONFIDENTLY derive the owner list endpoint, it should not dead-end with miss-no-list, but EMIT item.candidates — the plausible GET/list endpoints ranked by structural proximity (shared longest path prefix, list-verb near the param stem) — WITHOUT deciding. The agent (which owns judgment) reads candidates and picks, or fires one zond request against the top candidate. This converts an open-ended 'zond must handle every URL shape' (creep treadmill) into 'zond surfaces evidence, agent judges' (the split m-24 established). Less code long-term than N shape-specific rules. item.candidates field already exists in the DiscoveryItem schema (task ARV-376 referenced it) — currently always null. Scope: populate it; leave the pick to the agent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 miss-no-list items carry a non-null candidates[] of plausible list endpoints when no confident owner exists
- [ ] #2 candidates ranked by structural proximity, NOT decided (zond does not pick a value)
- [ ] #3 no new hardcoded marker/verb lists added to close specific shapes
<!-- AC:END -->

---
id: ARV-381
title: >-
  disambig parent-walk should skip version segments (align with
  owningCollectionForPathParam)
status: Done
assignee: []
created_date: '2026-07-09 10:06'
updated_date: '2026-07-09 10:14'
labels:
  - bug
  - generator
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ARV-376 follow-up, class 1 of remaining miss-no-list. /api/macros/v30/{code}: disambig's parent-walk stops at the version segment v30, so the code param scopes inconsistently with owningCollectionForPathParam (which ALREADY strips versions via stripTrailingVersionSegments). Net: manifest var macros_v30_code has no matching resource-graph owner → miss-no-list. Fix: apply stripTrailingVersionSegments in path-param-disambig.ts parent-walk, same as suite-generator already does. NOT new domain knowledge — makes two layers agree on a version-strip decision that already exists and is accepted. Deterministic, litmus-clean. Covers the /v30/{code} half of the remaining 30.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 disambig parent-walk skips trailing version segments
- [ ] #2 macros_v30_code / templates_v30_code resolve to their resource on docgen-core-merged
- [ ] #3 no regression in path-param-disambig.test.ts / resources-builder.test.ts
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
disambig parent-walk now skips version segments (isVersionSeg, same regex as stripTrailingVersionSegments) alongside accessor markers → aligns with owningCollectionForPathParam which already strips versions. docgen-core-merged: miss-no-list 30→22 (all /v30/{code} resolved). Tests in path-param-disambig.test.ts.
<!-- SECTION:NOTES:END -->

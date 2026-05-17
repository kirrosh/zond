---
id: ARV-262
title: 'annotate: --auto-apply --confidence high for large API scope'
status: Done
assignee: []
created_date: '2026-05-17 06:50'
updated_date: '2026-05-17 10:19'
labels:
  - feature
  - annotate
  - large-api
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`zond api annotate dump` for 5 aspects on a 1184-endpoint API emits 5.9 MB of JSON. Current flow requires the agent to hand-write a YAML overlay per resource per aspect — impractical at scale.

Consequence: `zond checks run --check stateful` on GitHub returned 0 findings because defaults didn't auto-detect `?page=N&per_page=M` pagination, `state` lifecycle field on issues/PRs, or `Idempotency-Key` candidates.

Discovered: zond-scan on GitHub public REST API (1184 endpoints), 2026-05-17.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Add `zond api annotate auto --api <name> --aspect pagination --confidence high` that writes only safe heuristic inferences
- [x] #2 Heuristics for pagination: detect `page`+`per_page` → page-style; `cursor`/`starting_after`/`after`/`page_token` → cursor-style
- [x] #3 Heuristics for lifecycle: detect `state`/`status` enum response fields, infer observation-mode states from schema
- [x] #4 Heuristics for idempotency: detect `Idempotency-Key` header parameters
- [x] #5 --auto-apply --confidence high writes only high-confidence inferences; medium/low requires explicit agent overlay
- [x] #6 Test: GitHub spec annotate-auto produces non-empty overlay for issues, repos, pulls, comments
<!-- AC:END -->

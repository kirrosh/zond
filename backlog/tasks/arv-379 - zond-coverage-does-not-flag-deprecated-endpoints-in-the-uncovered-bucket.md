---
id: ARV-379
title: zond coverage does not flag deprecated endpoints in the uncovered bucket
status: To Do
assignee: []
created_date: '2026-07-09 08:53'
labels:
  - feature
  - coverage
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Session: `zond coverage --api docgen-core-merged --union since:2h` reported 64 uncovered endpoints and a text-summary hint ("48 of those are deprecated") but the `--json` uncoveredEndpoints array is a flat list of method+path strings with no deprecated flag. To separate "structurally out of scope by design" from "real, closeable gap" I had to hand-write a python script that re-opened spec.json and cross-referenced each uncovered path/method against its `deprecated` field.

Proposed: add a `deprecated: boolean` field per entry in `data.uncoveredEndpoints` (and `partialEndpoints`/`coveredEndpoints` for symmetry) in `--json` output, and/or a `--exclude-deprecated` flag on the text summary so "real gap" vs "deprecated, skip by design" doesn't require re-reading spec.json by hand every time. The count is already computed internally (that's where the "48 of those are deprecated" text-summary line comes from) — just needs to be attached per-endpoint instead of only as an aggregate.

Litmus test: `deprecated` is a spec-declared boolean, zero judgment involved — belongs in zond core.
<!-- SECTION:DESCRIPTION:END -->

---
id: ARV-389
title: >-
  release pipeline: one reproducible cross-compile → sign → checksum → publish
  run
status: To Do
assignee: []
created_date: '2026-07-09 12:56'
labels:
  - m-27
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today build compiles only the local arch. Make one documented script/CI job cross-compile all targets (bun build --compile --target=...), codesign darwin (script exists), emit checksums, attach to gh release, publish npm, bump brew — no manual per-arch assembly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A single command/CI run produces all 5 signed artifacts + checksums attached to the release
- [ ] #2 npm publish and brew bump are part of (or triggered by) the same flow
<!-- AC:END -->

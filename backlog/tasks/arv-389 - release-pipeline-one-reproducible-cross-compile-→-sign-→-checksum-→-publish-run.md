---
id: ARV-389
title: >-
  release pipeline: one reproducible cross-compile → sign → checksum → publish
  run
status: Done
assignee: []
created_date: '2026-07-09 12:56'
updated_date: '2026-07-09 13:23'
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
- [x] #1 A single command/CI run produces all 5 signed artifacts + checksums attached to the release
- [x] #2 npm publish and brew bump are part of (or triggered by) the same flow
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Tag push = one run: build matrix cross-compiles 5 targets (--target), darwin adhoc codesign step, release job emits checksums.txt + attaches all artifacts + regenerates and pushes brew formula (TAP_GITHUB_TOKEN), publish job npm publish. Documented in docs/ci.md 'Release pipeline'. Real Developer ID signing/notarization deliberately not added (adhoc + install.sh/brew re-sign path works; upgrade path documented in ci.md).
<!-- SECTION:NOTES:END -->

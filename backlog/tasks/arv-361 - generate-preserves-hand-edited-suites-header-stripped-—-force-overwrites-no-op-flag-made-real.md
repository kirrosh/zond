---
id: ARV-361
title: >-
  generate preserves hand-edited suites (header-stripped) — --force overwrites,
  no-op flag made real
status: Done
assignee: []
created_date: '2026-07-07 08:55'
labels:
  - zond
  - m-24
  - generator
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
m-24 gap from cut-list: generate overwrote suite files unconditionally, silently discarding agent edits; --force was a documented no-op. Fix: files whose auto-gen header was removed are treated as hand-edited and preserved on regenerate (honouring the header's own 'drop header to keep' promise); files that still carry the header are regenerated as before; --force overwrites even header-stripped files. Deterministic (header-marker check), no judgment. Test: tests/cli/generate-preserve-edited.test.ts. Skill zond-triage.md regenerate_suite guidance updated.
<!-- SECTION:DESCRIPTION:END -->

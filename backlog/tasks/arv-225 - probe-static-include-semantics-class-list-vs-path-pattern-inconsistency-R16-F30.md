---
id: ARV-225
title: >-
  probe static --include semantics: class-list vs path-pattern inconsistency
  (R16/F30)
status: Done
assignee: []
created_date: '2026-05-14 10:11'
updated_date: '2026-05-16 08:31'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 16, finding F30, class ux-papercut, severity MEDIUM.

Repro:
  zond probe static --api github --include 'path:^/meta$'
  # — probe static accepts CLASSES (validation, methods), not selectors
  zond probe security --api github ssrf --include 'path:^/meta$'
  # — probe security accepts SELECTORS

Three commands share the --include name but have different semantics:
  - checks run --include: selector (path:/method:/tag:/operation-id:)
  - probe security --include: selector (same)
  - probe static --include: class-list (validation, methods)

Fix: either unify the semantics (selector across the board, add --include-class for class-list), or rename probe static's flag to --include-class.

Log: see feedback-16.md F30.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Renamed probe static --include/--exclude → --include-class/--exclude-class to disambiguate from selector-style --include on probe security / probe mass-assignment / checks run. Old --include/--exclude kept as deprecated aliases with stderr warning ('class-list, not a selector — collides with probe security / checks run; use --include-class').

Selector grammar (path:/method:/tag:/operation-id:) for probe static itself is out of scope here — that would be a separate feature. ARV-225 is purely the naming/clarity fix.
<!-- SECTION:NOTES:END -->

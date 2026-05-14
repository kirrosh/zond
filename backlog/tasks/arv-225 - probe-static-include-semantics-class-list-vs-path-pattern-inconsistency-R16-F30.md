---
id: ARV-225
title: >-
  probe static --include semantics: class-list vs path-pattern inconsistency
  (R16/F30)
status: To Do
assignee: []
created_date: '2026-05-14 10:11'
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

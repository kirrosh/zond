---
id: ARV-217
title: >-
  annotate apply: hint when checks --include scope misses annotated resource
  (R14/F22)
status: To Do
assignee: []
created_date: '2026-05-14 10:05'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 14, finding F22, class ux-papercut, severity LOW.

Repro:
  zond api annotate apply --pagination ... --yes  # adds pagination for resource 'tasks' (basePath /agents/tasks)
  zond checks run --api github --check stateful --include 'path:^/(users/octocat|meta)$' --report ndjson
  # → pagination_invariants ×67 skipped: 'no pagination config and no cursor-style query param'

Expected: when an annotate call applies pagination config for resource X but the next checks run --include scope does not include X's basePath, surface a hint:
  'pagination annotated for resource tasks (basePath /agents/tasks) — not in this run scope; add it to --include to exercise pagination_invariants'.
Or: annotate apply could emit a follow-up hint of recommended --include patterns.

Actual: silent skip; user has no signal the annotation took effect or that the scope is too narrow.

Log: see feedback-14.md F22.
<!-- SECTION:DESCRIPTION:END -->

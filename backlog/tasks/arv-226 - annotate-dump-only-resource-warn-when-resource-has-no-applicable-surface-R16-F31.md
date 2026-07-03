---
id: ARV-226
title: >-
  annotate dump --only <resource>: warn when resource has no applicable surface
  (R16/F31)
status: Done
assignee: []
created_date: '2026-05-14 10:11'
updated_date: '2026-05-17 05:44'
labels:
  - feedback-loop
  - api-github
  - m-21
  - polish-m-22
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 16, finding F31, class ux-papercut, severity LOW.

Repro:
  zond api annotate dump --api github --idempotency --only tasks  # → []
  zond api annotate dump --api github --readback   --only tasks   # → []
  zond api annotate dump --api github --seed-bodies --only tasks  # → []
  # without --only the same flags emit surface for other resources

Expected: warning 'resource X has no POST/PUT/PATCH operations — --readback/--seed-bodies/--idempotency not applicable' so users can distinguish 'wrong spelling' from 'no surface'.

Actual: empty []; indistinguishable from 'unknown resource'.

Log: see feedback-16.md F31.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done 2026-05-17 (polish-m-22 batch-2 / annotate): annotate dump --only emits per-resource stderr lines distinguishing 'not in .api-resources.yaml' from 'no applicable surface for --<kind>' so empty [] is no longer ambiguous.
<!-- SECTION:NOTES:END -->

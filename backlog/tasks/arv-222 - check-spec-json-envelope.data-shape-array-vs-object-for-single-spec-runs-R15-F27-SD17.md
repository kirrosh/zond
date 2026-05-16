---
id: ARV-222
title: >-
  check spec --json: envelope.data shape (array vs object) for single-spec runs
  (R15/F27/SD17)
status: To Do
assignee: []
created_date: '2026-05-14 10:08'
updated_date: '2026-05-16 10:55'
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
Source: feedback round 15, finding F27 + SD17, class ux-papercut, severity LOW.

Repro:
  zond check spec --api github --json | jq '.data | type' → 'array'
  jq '.data[0].stats.total' works; jq '.data.stats.total' returns null

Expected: either (a) .data is an object for single-spec runs (consistency with doctor, diagnose, coverage), or (b) the array-shape is documented in skill so users write jq '.data[].stats'.

Log: see feedback-15.md F27.
<!-- SECTION:DESCRIPTION:END -->

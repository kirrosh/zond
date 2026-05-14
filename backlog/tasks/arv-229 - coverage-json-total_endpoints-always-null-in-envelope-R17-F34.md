---
id: ARV-229
title: 'coverage --json: total_endpoints always null in envelope (R17/F34)'
status: To Do
assignee: []
created_date: '2026-05-14 10:12'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 17, finding F34, class ux-papercut, severity LOW.

Repro:
  zond coverage --api github --json | jq '.data | {total_endpoints, hit_coverage}'
  # → {"total_endpoints": null, "hit_coverage": {"covered":76,"total":1183,"ratio":0.0642}}

Expected: total_endpoints filled (1183), or removed from envelope if unused.

Log: see feedback-17.md F34.
<!-- SECTION:DESCRIPTION:END -->

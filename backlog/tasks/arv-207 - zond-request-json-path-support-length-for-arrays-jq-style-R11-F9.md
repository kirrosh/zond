---
id: ARV-207
title: 'zond request --json-path: support ''length'' for arrays (jq-style) (R11/F9)'
status: Done
assignee: []
created_date: '2026-05-14 08:22'
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
Source: feedback round 11, finding F9, class missing-feature, severity LOW.

Repro:
  zond request GET '/user/repos?per_page=5' --api github --json-path 'length'
  # → 'expected an array index, got non-numeric segment length'

Expected: generic way to get array length (e.g. 'length' or '[length]' jq-style). Critical for harvest logic 'length>0 → has data; length==0 → seed'.

Actual: only [N]/N index supported; checking 'is there any data' requires shelling out to jq, which breaks the 'sufficient-tooling' promise of zond request.

Impact: in one zond request call cannot tell 'is the list non-empty?', making harvest logic clunkier than prepare-fixtures needs.

Log: see feedback-11.md F9.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done 2026-05-17 (polish-m-22 batch-2 / request): extractByPathWithDiagnostic supports the jq-style 'length' segment on arrays (send-request.ts). New unit tests cover top-level, nested, and empty cases; error message points users at 'length' when a non-numeric segment hits an array.
<!-- SECTION:NOTES:END -->

---
id: ARV-374
title: >-
  resource-name derivation still eats a mid-path version segment on
  /api/<resource>/v{N}/{id} shape (v30_id)
status: To Do
assignee: []
created_date: '2026-07-09 08:39'
labels:
  - bug
  - generator
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Related to ARV-369/372 (fixed: trailing version segment eaten as resource name on /api/<resource>/v{N} paths) — same class of bug resurfaces for a *middle*-of-path version segment.

repro (docgen-core-service, merged v20+v30 spec at ~/Projects/zond-scans/apis/docgen-core-merged):
- DELETE /api/textblock-versions/v30/{v30_id}
- POST /api/textblock-versions/v30/{v30_id}/clone

Expected fixture var: textblock_versions_id (owning resource = textblock-versions, version segment v30 stripped).
Actual: v30_id — the version segment "v30" got treated as the resource-name component instead of the true resource "textblock-versions" preceding it. No list endpoint exists for this resource either (miss-no-list in prepare-fixtures), compounding the miss — nothing signals which resource actually owns this id.

Litmus test: deterministic path-segment parsing, same helper family as stripTrailingVersionSegments (ARV-369/372) — likely needs the same fix applied to param-derivation, not just resource-name-for-CRUD-grouping. Check whether the existing fix only covers the trailing-segment case and this is the same bug in the path-param-naming code path specifically (fixtures-builder.ts step 3 / fixtureVarNameForPathParam in suite-generator.ts).
<!-- SECTION:DESCRIPTION:END -->

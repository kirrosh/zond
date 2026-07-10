---
id: ARV-373
title: >-
  path-param fixture var collapses 5 distinct byid-resources into one shared
  name (byid_id)
status: To Do
assignee: []
created_date: '2026-07-09 08:38'
updated_date: '2026-07-10 07:29'
labels:
  - bug
  - generator
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Same root-cause class as ARV-369/372 (path-param fixture disambiguation), different path shape: /byid/{id} instead of trailing {code}.

repro (docgen-core-service v20, merged with v30 into one 253-endpoint spec at ~/Projects/zond-scans/apis/docgen-core-merged):
- GET /api/business-segment20/byid/{byid_id}
- GET /api/deal-kind20/byid/{byid_id}
- GET /api/deal-type20/byid/{byid_id}
- GET /api/preference-program20/byid/{byid_id}
- GET /api/shared-table20/byid/{byid_id}

All 5 collapse to one shared `.api-fixtures.yaml` entry `byid_id` instead of `business_segment20_byid_id` / `deal_kind20_byid_id` / etc. (owning-resource disambiguation from ARV-369 fixed the {code}-style trailing param but this /byid/{id} shape wasn't covered — same naive param-name-as-key bug, different call site).

impact: setting byid_id to a valid shared-table20 id (39) satisfies that resource's byid endpoint but produces false 404s on the other 4 resources when run through zond run/checks — same failure mode ARV-369 fixed for {code}.

Litmus test: deterministic path-parsing bug, not a judgment call — belongs in zond core (fixtures-builder.ts / suite-generator.ts owning-resource disambiguation), same helper family as stripTrailingVersionSegments.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
m-28 Bucket C (evidence-first): промотировать в работу, когда corpus-прогон подтверждает класс проблемы на реальном API; не брать спекулятивно.
<!-- SECTION:NOTES:END -->

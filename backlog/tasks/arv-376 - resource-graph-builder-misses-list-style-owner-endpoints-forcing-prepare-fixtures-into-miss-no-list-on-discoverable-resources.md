---
id: ARV-376
title: >-
  resource-graph builder misses /list-style owner endpoints, forcing
  prepare-fixtures into miss-no-list on discoverable resources
status: To Do
assignee: []
created_date: '2026-07-09 08:52'
labels:
  - bug
  - generator
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Session: merged docgen-core-service v20+v30 spec (253 endpoints). `zond prepare-fixtures --api docgen-core-merged` reported 37 of 41 missing v20 fixture vars as `miss-no-list: path-source var has no owner resource in .api-resources.yaml — cannot derive a list endpoint`.

But the list endpoints objectively exist in the catalog for most of these resources:
- GET /api/business-segment20/list
- GET /api/deal-kind20/list
- GET /api/deal-type20/list
- GET /api/preference-program20/list
- GET /api/shared-table20/list
- GET /api/fields20/list
- GET /api/textblock20/list
- GET /api/template20/list

Each of these resources also has `/byid/{id}` and/or `/{code}` read-by-id endpoints and `{resource}_id`/`byid_id`/`code` path-param fixtures that prepare-fixtures wants to fill — but the `.api-resources.yaml` builder never associated the `/list` endpoint with the resource's id/code param, so prepare-fixtures had no owner to query and gave up with `miss-no-list` instead of surfacing real candidates.

I had to work around this by hand-running `zond request GET /api/<resource>/list --api <name>` in a loop and manually picking ids/codes to `zond fixtures add`. If the resource graph correctly linked `/list` (also check `/search`, `/find` as plausible list-shaped candidates) to its sibling `/byid/{id}` and `/{code}` endpoints, prepare-fixtures' existing "report candidates" mechanism (item.candidates field already exists in the schema, was just null here) would have surfaced this without any agent-side request loop.

repro: `apis/docgen-core-merged` in ~/Projects/zond-scans (or re-derive from docgen-core v20 spec: /docgen2/docgen-core-service/docgen-api/v20/swagger.json).

Litmus test: deterministic resource-graph construction from spec shape (list-endpoint-to-id-param linking), no judgment — belongs in zond core (resources-builder.ts), likely the same family as the {code}/byid_id path-param work in ARV-373.
<!-- SECTION:DESCRIPTION:END -->

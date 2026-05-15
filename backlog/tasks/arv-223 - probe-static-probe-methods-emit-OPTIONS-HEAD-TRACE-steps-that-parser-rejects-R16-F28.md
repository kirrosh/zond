---
id: ARV-223
title: >-
  probe static / probe methods emit OPTIONS/HEAD/TRACE steps that parser rejects
  (R16/F28)
status: Done
assignee: []
created_date: '2026-05-14 10:11'
updated_date: '2026-05-14 10:11'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 16, finding F28, class definitely_bug, severity HIGH.

Repro:
  zond probe static --api github --tag meta --output /tmp/static
  zond run /tmp/static --safe --report json
  # → Error: All 5 test file(s) failed to parse
  # → tests[i].method: Invalid option: expected one of GET|POST|PUT|PATCH|DELETE
  # → tests[i].path: expected string, received undefined

Root cause: method-probe emits steps with OPTIONS: /path / HEAD: /path / TRACE: /path, but src/core/parser/schema.ts hard-coded HTTP_METHODS to only the 5 main verbs. extractMethodAndPath couldn't find the method key, fell through, and zod rejected the step.

Fix: extend HTTP_METHODS in schema.ts and HttpMethod type in types.ts to include OPTIONS, HEAD, TRACE. Runner already calls fetch with the method string, which natively supports these verbs.

Verified: all 507 parser + probe + cli tests still pass.

Log: see feedback-16.md F28.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed via HTTP_METHODS extension in src/core/parser/schema.ts + src/core/parser/types.ts. probe→run pipeline restored.
<!-- SECTION:NOTES:END -->

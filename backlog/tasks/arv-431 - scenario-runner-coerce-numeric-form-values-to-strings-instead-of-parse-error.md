---
id: ARV-431
title: 'scenario runner: coerce numeric form: values to strings instead of parse-error'
status: Done
assignee: []
created_date: '2026-07-11 07:43'
updated_date: '2026-07-11 08:02'
labels:
  - m-28
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stripe deep-dive (m-28): scenario 'form:' bodies reject numeric values ('expected string, received number') at parse time, while 'json:' accepts numbers. Every int must be hand-quoted. Form is all-strings on the wire — the parser should coerce numbers→strings for form bodies (or at least accept them). DX friction, deterministic → zond.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 form: values accept numbers, coerced to strings
- [ ] #2 json: behavior unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed: src/core/parser/schema.ts — FormScalarSchema coerces number/boolean→string for form:/query: values (encodeFormBody already String()'d at runtime). Test: tests/parser/schema.test.ts ARV-431. Verified live: scenario with amount:1500/balance:-100 unquoted → 2/2 pass, body encoded correctly.
<!-- SECTION:NOTES:END -->

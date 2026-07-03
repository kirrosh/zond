---
id: ARV-307
title: >-
  status_code_conformance / content_type_conformance lack broken-baseline
  suppression
status: Done
assignee: []
created_date: '2026-07-02 11:09'
updated_date: '2026-07-02 11:35'
labels:
  - zond-side
  - bug
dependencies: []
references:
  - backlog/tasks — ARV-181
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a ~100% auth-rejected baseline (all 401/404, zero 2xx), status_code_conformance and content_type_conformance emit thousands of 'undeclared status/content-type' findings that are pure baseline artifacts. Stateful checks (pagination_invariants, cross_call_references, use_after_free) correctly emit a single 'broken-baseline guard' spec_finding and skip; conformance checks have no equivalent guard. Repro: zond checks run --api <target> where every response is 401/404 → 2542 findings across 4561 cases (401-baseline run). Related: ARV-181 (broken-baseline guard for ignored_auth). Found via zond-audit github 401-baseline run 20260702-125322.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 conformance checks detect a broken/degenerate baseline (e.g. >Nth% non-2xx) and roll up to a single spec_finding + skip, like stateful checks
- [ ] #2 threshold documented; guard covers status_code_conformance and content_type_conformance
<!-- AC:END -->

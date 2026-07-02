---
id: ARV-309
title: >-
  probes in safe/GET-only mode emit plan with no 'not executed' line / no result
  artifact
status: Done
assignee: []
created_date: '2026-07-02 11:09'
updated_date: '2026-07-02 11:35'
labels:
  - zond-side
  - ux
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In safe/GET-only depth-pass, zond probe mass-assignment and zond probe <security> write a plan (list of '+ POST ... classes=...') ending in 'Plan: N planned - M skipped' but no findings section and no statement that the plan was NOT executed. A reader cannot tell 'ran, found nothing' from 'never fired'. Repro: zond probe mass-assignment --dry-run / --emit-tests in GET-only mode. Expected: explicit line e.g. 'safe/GET-only mode: mutation probes not executed — pass --live to run'. Found via zond-audit github runs (report-zond Z3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 probe output in non-executing mode prints an explicit 'not executed (reason)' line, not just a plan that reads like results
<!-- AC:END -->

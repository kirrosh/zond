---
id: ARV-357
title: >-
  zond run on empty test dir exits 0 and writes no --output file (silent
  pipeline gap)
status: To Do
assignee: []
created_date: '2026-07-06 15:40'
labels:
  - zond-bug
  - ux
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: run 20260706-175930. 'zond run apis/stripe/probes/mass-assignment --report json --output raw/52-run-ma.json' on an empty dir printed only 'Warning: No test files found in <dir>', exit 0, and NEVER created 52-run-ma.json/53-run-sec.json. A scripted pipeline sees a missing file with no error to key on. LITMUS: deterministic UX fix. Either non-zero exit on empty dir, or still write the --output file with an explicit '{tests:0, nothing to report}' envelope so downstream stages don't silently skip.
<!-- SECTION:DESCRIPTION:END -->

---
id: ARV-318
title: 'zond run accounting: error steps excluded from total=passed+failed+skipped'
status: To Do
assignee: []
created_date: '2026-07-02 15:18'
labels:
  - reporter
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live Stripe run 20260702-174915. status=error steps reconcile into no bucket: negative-suite total=150/passed=0/failed=0/skipped=0 (150 error nowhere); positive-suite total=258/skipped=150 leaves 108 error unaccounted. Invariant total=passed+failed+skipped+error should hold, or error steps get their own surfaced count. (Related: run exit-code prints '0 failed — exiting code 1' without naming the error steps as the cause.)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 run summary accounts for error steps (total reconciles or error count surfaced)
- [ ] #2 exit-code closing line names error steps when they drive a non-zero exit
<!-- AC:END -->

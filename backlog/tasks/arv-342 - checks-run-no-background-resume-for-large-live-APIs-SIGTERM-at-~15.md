---
id: ARV-342
title: 'checks run: no background/resume for large live APIs (SIGTERM at ~15%)'
status: Done
assignee: []
created_date: '2026-07-06 10:52'
updated_date: '2026-07-06 14:06'
labels:
  - zond-missing-feature
  - checks
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: live Stripe audit 2026-07-06. zond checks run --phase coverage on 587 ops @ rate-limit 30 cannot finish in a foreground window (est. ~13min > 600s bash cap). The audit reached only 87/587 ops (15%) before SIGTERM; even backgrounded it was interrupted. Needs: op-count-aware default, a --resume/checkpoint, or a documented detached-run path so wide specs complete.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed earlier (see git log: 8f8846a ARV-340/341, 513ad26 ARV-342). Backlog status was stale; marking Done.
<!-- SECTION:NOTES:END -->

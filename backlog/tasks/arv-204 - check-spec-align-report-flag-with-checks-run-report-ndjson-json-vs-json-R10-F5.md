---
id: ARV-204
title: >-
  check spec: align report flag with checks run (--report ndjson|json vs --json)
  (R10/F5)
status: Done
assignee: []
created_date: '2026-05-14 08:11'
updated_date: '2026-05-16 11:20'
labels:
  - feedback-loop
  - api-github
  - m-21
  - polish-m-22
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 10, finding F5, class ux-papercut, severity LOW.

Repro:
  zond check spec --api github --report json
  # → error: unknown option '--report'
  zond check spec --api github --json   # works, but different flag than checks run

Expected: unified flag (--report ndjson|json) consistent with zond checks run; or document the divergence explicitly.

Actual: check spec uses --json, checks run uses --report — UX inconsistency that breaks 'run them all' scripts.

Log: zond check spec --api github --report json 2>&1.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done 2026-05-16 (polish-m-22 batch-1): added --report <console|json|ndjson> on check spec / lint as an alias of --json / --ndjson for parity with checks run (check.ts defineCheckSpec). Last writer wins if combined.
<!-- SECTION:NOTES:END -->

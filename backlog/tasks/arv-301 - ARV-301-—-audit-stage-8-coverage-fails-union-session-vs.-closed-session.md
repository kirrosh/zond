---
id: ARV-301
title: 'ARV-301 — audit stage 8 (coverage) fails: --union session vs. closed session'
status: To Do
assignee: []
created_date: '2026-05-18 15:26'
labels:
  - bug
  - zond-side
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bug: `zond audit` stage 8 runs `coverage --union session` AFTER stage 7 (`session end`), and the CLI refuses to compute coverage on a closed session. HTML report is therefore truncated (no coverage section) on every audit run. Found 2026-05-18 on live Stripe scan (~/Projects/zond-scans/reports/stripe/20260518T151150Z).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 audit stages 7 and 8 either coexist (compute coverage before closing session, or compute on the persisted session via --session-id)
- [ ] #2 audit-pipeline test reproduces the failure on master and passes on the fix
- [ ] #3 HTML report carries coverage section after the fix
<!-- AC:END -->

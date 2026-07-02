---
id: ARV-317
title: probe --dry-run does not persist emit-tests / --output inventory (stdout only)
status: To Do
assignee: []
created_date: '2026-07-02 15:18'
labels:
  - probe
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live Stripe run 20260702-174915. 'zond probe mass-assignment --dry-run --emit-tests <dir> --output ma-digest.md' reports 290 planned but the emit dirs (probes/mass-assignment, probes/security) stay empty and --output ma-digest.md is never written — the planned inventory survives only on stdout. dry-run should persist its inventory to the requested paths so an agent can read it back.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 probe <class> --dry-run --emit-tests <dir> writes the planned inventory files
- [ ] #2 probe <class> --dry-run --output <file> writes the digest
<!-- AC:END -->

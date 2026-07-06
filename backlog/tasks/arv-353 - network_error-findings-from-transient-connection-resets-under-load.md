---
id: ARV-353
title: network_error findings from transient connection resets under load
status: To Do
assignee: []
created_date: '2026-07-06 13:04'
labels:
  - zond-bug
  - runner
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: run 20260706-150730. 720 status-0 (connection resets) under high windowed concurrency, 24 became network_error findings. These are transport flakiness under probe volume, not confirmed API defects — noise in the report.

LITMUS: deterministic robustness fix — retry N times on a transient reset (ECONNRESET/socket closed) before emitting a network_error finding, so transport-flake is distinguished from a real fix_network_config signal. Belongs in zond.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 transient connection resets are retried before a network_error finding is emitted
<!-- AC:END -->

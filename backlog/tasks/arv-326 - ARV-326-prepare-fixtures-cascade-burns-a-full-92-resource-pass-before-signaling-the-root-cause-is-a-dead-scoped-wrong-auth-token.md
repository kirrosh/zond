---
id: ARV-326
title: >-
  ARV-326: prepare-fixtures --cascade burns a full 92-resource pass before
  signaling the root cause is a dead/scoped-wrong auth token
status: To Do
assignee: []
created_date: '2026-07-03 07:42'
labels:
  - prepare-fixtures
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on Stripe zond-audit run 20260703-094334 (raw/02-fixtures.log, raw/03-doctor.json), against a dead/wrong-env auth token. 'zond prepare-fixtures --api stripe --apply --cascade' produced ~90 identical failed:miss-status ... 401 lines (auth/scope rejection), but only surfaces 'Filled 0/92 path-FK vars (0%)' at the very end, after running the full cascade across all 92 resources. On a large spec like Stripe's this is slow to notice -- a single early-exit line as soon as e.g. N consecutive/majority list probes return 401 ('auth appears broken -- stopping cascade early') would save the wasted pass. (Mitigated at the orchestration layer by an auth smoke-check added to the zond-audit workflow, but prepare-fixtures itself has no such fast-fail for direct CLI users.) Fix: track the 401/403 rate across cascade discovery probes and short-circuit with a clear message once it crosses a majority threshold, instead of running to completion.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 prepare-fixtures --cascade exits early (before completing all resources) with a clear 'auth appears broken' message once a majority of discovery probes return 401/403
<!-- AC:END -->

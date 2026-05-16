---
id: ARV-24
title: >-
  checks run --check <stateful_id> reports 'Unknown check' even though it's
  listed
status: Done
assignee: []
created_date: '2026-05-10 07:59'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F1, class definitely_bug
Repro: zond checks run --api resend --check ignored_auth → 'Unknown check: ignored_auth'. zond checks list shows it.
Cause: selectChecks() only knows about response-phase registry. Stateful checks (ignored_auth/use_after_free/ensure_resource_availability) live in a separate registry, so their ids fall through to the 'unknown' bucket.
Fix: in runChecks(), filter rawSelection.unknown against listStatefulChecks() ids before reporting.
<!-- SECTION:DESCRIPTION:END -->

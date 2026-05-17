---
id: ARV-81
title: >-
  coverage without active session: emit stderr footer naming the latest run id
  (parity with F12)
status: Done
assignee: []
created_date: '2026-05-11 07:34'
updated_date: '2026-05-17 05:44'
labels:
  - feedback-loop
  - api-resend
  - m-16
  - polish-m-22
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F23, class ux-papercut. After ARV-71, coverage emits an auto-union footer when a session is active. The no-session case stays silent — user sees 'Pass 32/83' without knowing it's a single-run snapshot. Expected: stderr 'coverage: using latest run #N. For union, pass --union since:<dur> or --union runs:...'. Log: ~/Projects/zond-test/.fb-loop/rounds/raw-04.log
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done 2026-05-17 (polish-m-22 batch-2 / coverage): coverage emits a stderr footer 'using latest run #N' parity with the session footer (coverage.ts:640). Lets the no-session single-run snapshot stop looking like a regression.
<!-- SECTION:NOTES:END -->

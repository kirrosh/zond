---
id: ARV-81
title: >-
  coverage without active session: emit stderr footer naming the latest run id
  (parity with F12)
status: To Do
assignee: []
created_date: '2026-05-11 07:34'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F23, class ux-papercut. After ARV-71, coverage emits an auto-union footer when a session is active. The no-session case stays silent — user sees 'Pass 32/83' without knowing it's a single-run snapshot. Expected: stderr 'coverage: using latest run #N. For union, pass --union since:<dur> or --union runs:...'. Log: ~/Projects/zond-test/.fb-loop/rounds/raw-04.log
<!-- SECTION:DESCRIPTION:END -->

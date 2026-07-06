---
id: ARV-343
title: 'checks run: emit partial coverage/status artifacts on interrupt'
status: To Do
assignee: []
created_date: '2026-07-06 10:52'
labels:
  - zond-bug
  - coverage
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: live Stripe audit 2026-07-06. The coverage sweep was SIGTERM-killed before the emit stage, so 70-coverage.json and the status distribution were never written; triage had to reconstruct them from raw NDJSON. zond already flushes partial NDJSON — it should also flush a partial coverage/status summary on SIGTERM so interrupted runs stay analyzable.
<!-- SECTION:DESCRIPTION:END -->

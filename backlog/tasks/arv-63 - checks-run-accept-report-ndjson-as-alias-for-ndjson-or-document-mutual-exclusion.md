---
id: ARV-63
title: >-
  checks run: accept --report ndjson as alias for --ndjson (or document mutual
  exclusion)
status: Done
assignee: []
created_date: '2026-05-11 06:50'
updated_date: '2026-05-11 06:57'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F2, class ux-papercut. Repro: zond checks run --api resend --report ndjson → 'Error: Unknown --report format: ndjson. Available: sarif'. Expected: either --report ndjson works (alias), or --report --help shows that --ndjson is the separate flag for NDJSON output. Actual: --ndjson and --report are two distinct channels marked mutually exclusive only in --ndjson help, not --report; tester-skill prompt also references --report ndjson. Log: ~/Projects/zond-test/.fb-loop/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 checks run --report ndjson behaves exactly like --ndjson (streams events on stdout)
- [x] #2 --report help text and the 'Unknown --report format' error both list ndjson next to sarif
- [x] #3 regression test pins both branches (alias-success + unknown-format error)
<!-- AC:END -->

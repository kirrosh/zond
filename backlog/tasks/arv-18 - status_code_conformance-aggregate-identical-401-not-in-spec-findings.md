---
id: ARV-18
title: 'status_code_conformance: aggregate identical 401-not-in-spec findings'
status: To Do
assignee: []
created_date: '2026-05-10 07:22'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F2, class ux-papercut
Repro: zond checks run --api resend --include 'path:^/[^{]+$' → 30 identical 'Status 401 not declared in spec' rows.
Expected: aggregated 'Status 401 not declared in spec — 30 operations affected' with details under --verbose. zond check spec already does this for B1/B5.
Actual: 30 identical rows, drowning out single-shot findings from other checks.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->

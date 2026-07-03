---
id: ARV-73
title: >-
  coverage: include zond request hits (persist ad-hoc requests in run-store or
  add --include-requests)
status: To Do
assignee: []
created_date: '2026-05-11 07:05'
updated_date: '2026-05-18 13:02'
labels:
  - feedback-loop
  - api-resend
  - m-16
  - feature-m-22
  - defer-post-m-23
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F13, class missing-feature. Repro: zond request GET /audiences --api resend (200); zond coverage --api resend --union since:1h → /audiences still in unhit list. Expected: ad-hoc zond request under --api should log a hit (with kind=ad-hoc) or coverage --include-requests should pick them up. Actual: 4 /audiences endpoints stay unhit after 4 manual hits via zond request. Ask: persist to .zond/zond.db runs table or add the flag. Log: round-02 raw
<!-- SECTION:DESCRIPTION:END -->

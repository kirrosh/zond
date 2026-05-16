---
id: ARV-80
title: >-
  audit: print explicit path to the HTML report (and ideally to per-stage
  artifacts)
status: To Do
assignee: []
created_date: '2026-05-11 07:34'
updated_date: '2026-05-16 10:55'
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
Source: feedback round 03, finding F22, class ux-papercut (companion to F5/ARV-65). Repro: zond audit --api X → 'Warning: Audit complete → audit-report.html' — but the file is hard to locate without traversal. Expected: print the absolute path explicitly. Log: ~/Projects/zond-test/.fb-loop/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->

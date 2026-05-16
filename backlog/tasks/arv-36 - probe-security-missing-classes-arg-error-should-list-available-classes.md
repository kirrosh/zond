---
id: ARV-36
title: 'probe security: missing-classes-arg error should list available classes'
status: Done
assignee: []
created_date: '2026-05-10 11:20'
updated_date: '2026-05-11 02:58'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 09, finding F4, class ux-papercut
Repro: zond probe security --api resend → 'error: missing required argument classes' (no list). zond probe security broken-auth --api resend → 'Unknown class: broken-auth. Available: ssrf, crlf, open-redirect' (helpful list).
Expected: missing-required-argument path also prints the available class list. The data already exists in --help.
Actual: onboarding gap — first-time user has to read --help to learn what to type.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-09.log:75 (missing arg), :230 (unknown class)
<!-- SECTION:DESCRIPTION:END -->

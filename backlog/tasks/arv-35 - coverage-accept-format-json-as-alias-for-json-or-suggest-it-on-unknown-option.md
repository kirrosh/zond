---
id: ARV-35
title: >-
  coverage: accept --format json as alias for --json (or suggest it on
  unknown-option)
status: To Do
assignee: []
created_date: '2026-05-10 11:20'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 09, finding F3, class ux-papercut
Repro: zond coverage --api resend --format json → 'error: unknown option --format'. zond coverage --api resend --json works.
Expected: either accept --format json (kubectl/gh/aws-cli convention), or have the unknown-option error suggest 'did you mean --json?'. Same papercut on zond run --report json and zond probe --json.
Actual: minor but recurring — automation typos cost one run + a help read.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-09.log:2-3
<!-- SECTION:DESCRIPTION:END -->

---
id: ARV-44
title: >-
  run --validate-schema: auto-derive --spec from apis/<api>/spec.json when --api
  is given
status: To Do
assignee: []
created_date: '2026-05-10 11:36'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 11, finding F4, class ux-papercut
Repro: zond run apis/resend/tests --api resend --tag smoke --validate-schema → still need to add '--spec apis/resend/spec.json' explicitly even though --api already resolves it.
Expected: --validate-schema without --spec uses apis/<api>/spec.json (parity with probe static / probe security after ARV-33).
Actual: redundant flag for a trivial case; symmetric to ARV-33.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-11.log:1
<!-- SECTION:DESCRIPTION:END -->

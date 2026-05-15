---
id: ARV-239
title: 'zond report bundle --redact-identity: implement flag promised by skill'
status: To Do
assignee: []
created_date: '2026-05-14 11:16'
labels:
  - feedback-loop
  - api-github
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F12/SD8, class missing-feature/skill-drift
Repro: zond report bundle 3 -o /tmp/x/ --redact-identity
Expected: redaction identity-values (org/member slugs) перед share. Skill iron rule: 'Always pass --redact-identity for outbound sharing'.
Actual: 'error: unknown option --redact-identity' → exit 1. Без флага bundle прошёл (org=github / username=octocat в plain text).
Log: ~/Projects/zond-test/.fb-loop/rounds/raw-03.log
<!-- SECTION:DESCRIPTION:END -->

---
id: ARV-213
title: >-
  rate-limit auto: recognize x-ratelimit-* headers (GitHub/GitLab style)
  (R13/F17)
status: To Do
assignee: []
created_date: '2026-05-14 09:25'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 13, finding F17, class missing-feature / likely_bug, severity MEDIUM.

Repro:
  zond run apis/github/tests/smoke-meta-positive.yaml --rate-limit auto
  # after ~60 requests GitHub returns 403 + x-ratelimit-remaining: 0
  # zond keeps firing and gets 403s until x-ratelimit-reset

Expected: --rate-limit auto recognizes x-ratelimit-{used,remaining,reset,limit} headers (GitHub, GitLab, Notion etc) and throttles to the reset epoch.

Actual: only RFC9331 RateLimit-* are read; for GitHub-style x-ratelimit-* there's no slowdown — the entire 60/hour budget burns out in seconds.

Impact: depth-pass runs on GitHub get bricked for the next 60 min after first burst.

Log: see feedback-13.md F17.
<!-- SECTION:DESCRIPTION:END -->

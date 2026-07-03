---
id: ARV-213
title: >-
  rate-limit auto: recognize x-ratelimit-* headers (GitHub/GitLab style)
  (R13/F17)
status: Done
assignee: []
created_date: '2026-05-14 09:25'
updated_date: '2026-05-16 08:50'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Already implemented: parseRateLimitHeaders reads x-ratelimit-* aliases (rate-limiter.ts:158-160), Unix-epoch reset handled (line 55), note() fires on all responses incl. 403 (http-client.ts:149), --rate-limit auto wires AdaptiveRateLimiter (run.ts:359-366), test coverage exists (rate-limiter.test.ts:79). Verified across 1690 GitHub responses in feedback rounds 02/04 — 0 actual rate-exhaustion events; reported 403s were auth errors with remaining=4934/5000. F17 finding was speculative, not reproduced.
<!-- SECTION:NOTES:END -->

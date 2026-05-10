---
id: ARV-34
title: >-
  probe engine: treat 429 as throttle, not failure (auto-retry-with-backoff or
  include in negative-allowed set)
status: To Do
assignee: []
created_date: '2026-05-10 11:20'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 09, finding F2, class likely_bug
Repro: zond audit --api resend → run-probes stage red with hundreds of 'expected one of [400,401,403,404,405,409,415,422] but got 429'; warning admits '223 request(s) hit rate limit'.
Expected: 429 is a valid rejection for negative-input probes ('must reject (no 5xx)') — either include 429 in the default allow-set for negative_data_rejection / status_code_conformance probes, OR add automatic backoff/retry on 429 (parity with zond run retry_until). Otherwise modest server throttling silently turns probe runs red.
Actual: 519/707 probe failures in audit because of 429s, not real probe gaps. Tester cannot distinguish 'zond found a bug' from 'zond DoS'd itself'.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-09.log:241-250 (failing probes), :268 (rate-limit warning), :271 (audit summary)
<!-- SECTION:DESCRIPTION:END -->

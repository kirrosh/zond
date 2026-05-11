---
id: ARV-64
title: >-
  zond run: respect RateLimit-* / Retry-After (port --rate-limit auto from
  checks run)
status: Done
assignee: []
created_date: '2026-05-11 06:50'
updated_date: '2026-05-11 07:03'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F4, class missing-feature. Repro: zond run apis/resend/tests apis/resend/probes/static --report json (against Resend which sends RateLimit-Limit:5; w=1 + Retry-After:1 on 429). Expected: adaptive throttle by RateLimit-* (same --rate-limit auto as checks run / ARV-8), or at least auto-retry after Retry-After on 429. Actual: zond run hammers and gets 159 fail-steps purely from 429; warning '308 request(s) hit rate limit' shown only at end (not reactive). Ratio: 159/545 = 29% of failures are pure rate-limit noise; real fail-pool after dedup ~386. Ask: --rate-limit auto / --rate-limit <rps> in zond run --help. Log: ~/Projects/zond-test/.fb-loop/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond run without --rate-limit defaults to the adaptive limiter (no-op until a RateLimit-* header is seen, then paces by RFC 9568 policy)
- [x] #2 http-client already retries 429 with Retry-After (rate_limit_retries=5) — no change needed there; this fix lets the limiter learn the policy before more 429s arrive
- [x] #3 --rate-limit help describes the new default + that adaptive becomes the de-facto behaviour without a flag
- [x] #4 unit test: adaptive limiter is fast before a policy is seen; after note() with RateLimit-Policy:5;w=1 the next acquire waits ~policy interval
- [x] #5 regression: existing run-* tests pass (no behaviour change for APIs that don't publish RateLimit-* headers)
<!-- AC:END -->

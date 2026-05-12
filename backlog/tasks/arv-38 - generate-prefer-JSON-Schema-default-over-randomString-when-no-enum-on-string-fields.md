---
id: ARV-38
title: >-
  generate: prefer JSON-Schema 'default' over randomString when no enum on
  string fields
status: Done
assignee: []
created_date: '2026-05-10 11:30'
updated_date: '2026-05-10 11:34'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 10, finding F2, class missing-feature
Repro: zond generate --api resend --explain → POST /domains: tls = 'opportunistic' [enum]; PATCH /domains/{domain_id}: tls = '{{$randomString}}' [random]. Same field, but PATCH skips the schema's default.
Expected: when a string field has no enum but does have a JSON-Schema default, generator emits the default (deterministic, safe value) — same source-tier as 'open_tracking: true [default]' in the same explain table. Optionally extract 'X | Y' alternates from description as a fallback.
Actual: PATCH /domains/{domain_id} reliably 422s on every run because tls gets a random 8-char string. Tester cannot tell zond-mistake from API-bug.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-10.log:312-318 (POST), :319-324 (PATCH)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When a string field has no enum and no format-placeholder match, generator emits schema.default if it is a non-empty string (instead of {{$randomString}})
- [x] #2 classifyFieldSource returns 'default' for the same case so --explain reports the source correctly
- [x] #3 Existing format/enum/heuristic precedence is preserved (default only beats heuristic + random)
- [x] #4 Regression test covers PATCH-style schemas with default + no enum
- [x] #5 bun run check passes
<!-- AC:END -->

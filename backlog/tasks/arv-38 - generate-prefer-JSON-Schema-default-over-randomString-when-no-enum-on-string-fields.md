---
id: ARV-38
title: >-
  generate: prefer JSON-Schema 'default' over randomString when no enum on
  string fields
status: To Do
assignee: []
created_date: '2026-05-10 11:30'
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

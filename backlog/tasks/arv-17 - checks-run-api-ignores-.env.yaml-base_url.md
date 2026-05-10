---
id: ARV-17
title: checks run --api ignores .env.yaml base_url
status: Done
assignee: []
created_date: '2026-05-10 07:22'
updated_date: '2026-05-10 07:24'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F1, class definitely_bug
Repro: zond add api resend --spec ...; zond checks run --api resend → Error: Need --base-url. Same .env.yaml works for zond run / zond request / zond doctor.
Expected: zond checks run --api <name> reads base_url from apis/<name>/.env.yaml just like the error message promises and like other commands do.
Actual: error 'Need --base-url' — contract violated.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond checks run --api <name> resolves base_url from apis/<name>/.env.yaml when --base-url flag is omitted
- [x] #2 Resolution chain matches zond run/request/doctor: --base-url > opts.api > parent --api > ZOND_API_GLOBAL > ZOND_API > .zond/current-api
- [x] #3 Existing 'Need --base-url' error message remains for the truly ambiguous case (no API resolved at all)
- [x] #4 Auth-header derivation uses the same fallback chain — global --api also wires apis/<name>/.env.yaml auth_token/api_key
- [x] #5 Regression test in tests/cli/checks/ proves --api foo (parsed by program-level --api) flows into resolveBaseUrl
<!-- AC:END -->

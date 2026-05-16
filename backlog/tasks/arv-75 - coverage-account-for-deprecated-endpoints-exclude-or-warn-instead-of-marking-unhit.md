---
id: ARV-75
title: >-
  coverage: account for deprecated endpoints (exclude or warn instead of marking
  unhit)
status: Done
assignee: []
created_date: '2026-05-11 07:34'
updated_date: '2026-05-11 07:40'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F16, class missing-feature. Repro: spec has 4 deprecated /audiences/* endpoints; zond generate --include 'path:/audiences.*' skips them ('skipped 4 deprecated endpoint(s)'); zond coverage --api X then reports them as unhit so coverage looks artificially low (95% when really 100% of non-deprecated). Expected: separate 'deprecated_skipped' counter in coverage --json, or --exclude-deprecated flag (parity with generate), or stderr warning 'N endpoints excluded (deprecated)'. Log: ~/Projects/zond-test/.fb-loop/rounds/raw-03.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 coverage text mode prints '↳ N of those are deprecated' under the not-covered line when uncovered rows include deprecated endpoints
- [x] #2 coverage --json envelope gains deprecated_unhit + deprecated_total fields so agents can attribute the gap without re-reading the spec
- [x] #3 no regression for non-deprecated coverage stories — existing snapshots stay green
<!-- AC:END -->

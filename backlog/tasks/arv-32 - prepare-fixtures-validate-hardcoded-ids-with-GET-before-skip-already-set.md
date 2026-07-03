---
id: ARV-32
title: 'prepare-fixtures: validate hardcoded ids with GET before skip-already-set'
status: To Do
assignee: []
created_date: '2026-05-10 11:17'
updated_date: '2026-05-16 10:55'
labels:
  - feedback-loop
  - api-resend
  - m-16
  - feature-m-22
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 08, finding F3, class ux-papercut
Repro: zond prepare-fixtures --api resend --apply → email_id row prints 'skip-already-set (kept: c4c9...)' without probing if the id is still alive.
Expected: prepare-fixtures issues GET /<resource>/{id} for already-set ids; on 404 marks status=stale-refresh and re-captures via the standard discovery path. 'skip-already-set' should mean 'verified live'.
Actual: Resend emails expire ~30 days; CRUD tests depending on read-after-create-email start returning 404 with no diagnostic, tester blames the test rather than stale fixture.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-08.log:160
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Merged ARV-109 (validation-sprint 2026-05-16): doctor stale-fixture detection overlaps GET-validate; объединено в один трек hardcoded-id-verification.
<!-- SECTION:NOTES:END -->

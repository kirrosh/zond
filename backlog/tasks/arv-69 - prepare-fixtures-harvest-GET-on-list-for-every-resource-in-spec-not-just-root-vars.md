---
id: ARV-69
title: >-
  prepare-fixtures: harvest GET-on-list for every resource in spec, not just
  root vars
status: Done
assignee: []
created_date: '2026-05-11 07:05'
updated_date: '2026-05-11 07:14'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F10, class missing-feature. Repro: zond prepare-fixtures --api resend --apply --cascade. Expected: doctor lists 13 required FK vars (domain_id, segment_id, log_id, attachment_id, etc.); prepare-fixtures should attempt GET-on-list for EVERY resource referenced in spec, not only those whose var name matches a root resource. Actual: only email_id/contact_id/automation_id picked up; domain_id/segment_id/log_id silently skipped even though /domains and /segments return live records on the account; user must manually fetch them. Impact: ~16 'no-fixtures' cells reachable without seed-loop just from a more aggressive discover. Manual fill bumped coverage hit 93→95%, pass 69→78%. Log: ~/Projects/zond-test/.fb-loop/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 discover infers an owner resource by stripping FK suffixes (_id, _uuid, _slug, _name, _code, camelCase Id/Uuid) and matching singular ↔ plural resource names
- [x] #2 fallback runs only when targetsByVar has no entry — explicit fkDependency edges still win, no regression for the regular path
- [x] #3 resources without a list endpoint are skipped (no spurious GET on non-list paths)
- [x] #4 regression test: domain_id / segment_id / audience_id / segmentId / domain_uuid all resolve; base_url / auth_token / widgets_id don't
<!-- AC:END -->

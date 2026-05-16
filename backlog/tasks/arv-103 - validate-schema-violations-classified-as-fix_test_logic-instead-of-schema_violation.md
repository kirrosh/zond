---
id: ARV-103
title: >-
  validate-schema violations classified as fix_test_logic instead of
  schema_violation
status: Done
assignee: []
created_date: '2026-05-11 08:36'
updated_date: '2026-05-11 08:39'
labels:
  - feedback-loop
  - api-sentry
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F8, class definitely_bug
API: sentry

Repro:
  zond run apis/sentry/tests --safe --sequential --validate-schema \
    --report json --report-out run-02-schema.json
  zond db diagnose 17 --verbose --json | \
    jq '.data.failures[] | select(.assertions[]?.kind == "schema") | .recommended_action'
  # → 'fix_test_logic' (for ALL schema-violated tests)

Expected: per zond/SKILL.md L376-377, 'Schema violations land as schema_violation root_cause in zond db diagnose and are real backend bugs — treat them like 5xx, do not edit the expectation away'. Assertion with kind:'schema' must give schema_violation root_cause / report_backend_bug action.

Actual: for GET /api/0/projects/{org}/{proj}/ownership/ where body.raw expected type string but receives null, recommended_action='fix_test_logic'. Assertions correctly marked kind:schema, but root_cause classifier doesn't react to this kind.

Effect: real contract bugs (schema-drift in Sentry — undefined timestamp fields, undeclared status codes) drown in same group as {{$randomString}}-fails. Backend leaderboard looks green.

Log: $HANDOFF/rounds/raw-02.log + rounds/diagnose-17.json
Related: skill-drift SD5
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Schema violations (assertion kind:schema) classify as recommended_action=report_backend_bug
- [x] #2 Skill description in zond/SKILL.md L376-377 matches actual classifier behaviour
- [x] #3 Test pins schema kind → report_backend_bug
<!-- AC:END -->

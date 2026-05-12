---
id: ARV-42
title: >-
  db diagnose: branch recommended_action for generated tests
  (regenerate_fixtures / seed_path_param) instead of fix_test_logic
status: Done
assignee: []
created_date: '2026-05-10 11:36'
updated_date: '2026-05-10 11:49'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 11, finding F2, class quirk
Repro: zond db diagnose --json → every assertion_failed bucket maps to fix_test_logic, even for tests under apis/<api>/tests with source.generator=zond-generate.
Expected: when the failing test was emitted by the generator, recommended_action should not push the user to edit the YAML (next regenerate would clobber it). Branch on hint: 4xx with schema-mismatch hint → regenerate_fixtures; 404 on dynamic path-param → seed_path_param; spec-mismatch → fix_spec.
Actual: zond-triage skill keys off recommended_action; on this project the user is told to fix every generated test by hand, contradicting the file-header warning.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-11.log:227-231
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Add RecommendedAction value 'regenerate_suite' for generator-emitted tests that 4xx with schema-mismatch hint
- [x] #2 404 on generator-emitted tests routes to existing 'fix_fixture' (path-param needs seeding) instead of fix_test_logic
- [x] #3 Heuristic for 'is generated': provenance.type === 'openapi-generated' OR suite_file matches apis/<api>/tests/
- [x] #4 Existing recommendedAction(failureType, status) signature stays; new behaviour goes through an extended overload so existing call sites and tests don't break
- [x] #5 JSON schema for RecommendedAction includes regenerate_suite
- [x] #6 Regression test pins both new branches
- [x] #7 bun run check passes
<!-- AC:END -->

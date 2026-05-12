---
id: ARV-154
title: >-
  checks run --check ignored_auth: 0 cases emitted on 48 protected operations
  (silent fail)
status: Done
assignee: []
created_date: '2026-05-12 10:02'
updated_date: '2026-05-12 10:04'
labels:
  - feedback-loop
  - api-stripe
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F9, class likely_bug

Repro: zond checks run --api stripe --include 'path:^/v1/(customers|products|prices|webhook_endpoints)' --check ignored_auth --report ndjson
Expected: ignored_auth strips auth headers and verifies 401/403 — should emit at least 1 case per operation (48 cases for 48 ops).
Actual: summary {operations:48, cases:0, checks_run:1, findings:0}. Zero cases, zero findings. No skipped_outcomes in the envelope either.

Root cause hypotheses:
  - check requires fixtures that aren't in .env.yaml, but then should appear in skipped_outcomes
  - --include 'path:...' filter excludes endpoints differently for ignored_auth than for other checks

Skill .claude/skills/zond-checks/SKILL.md:36 advertises 'find security bugs, broken auth' via --check ignored_auth — current behavior contradicts that promise.

Log: $HANDOFF/rounds/checks-ignored-auth-03.ndjson, $HANDOFF/rounds/raw-03.log
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: stateful auth + CRUD branches in runner.ts only forwarded fail outcomes, never incremented summary.cases nor recorded skipped_outcomes. Non-stateful path already had this observability (ARV-26). Mirrored both branches. Now --check ignored_auth on 48 ops emits cases:48 + skipped_outcomes by reason. Commit 7fafeed.
<!-- SECTION:NOTES:END -->

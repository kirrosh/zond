---
id: ARV-31
title: 'prepare-fixtures: --apply --seed creates missing collection resources via POST'
status: Done
assignee: []
created_date: '2026-05-10 11:17'
updated_date: '2026-05-10 11:19'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 08, finding F1, class missing-feature
Repro: zond prepare-fixtures --api resend --apply → contact_id/automation_id rows show 'miss-empty: no contacts in target API — create one first'.
Expected: prepare-fixtures with new --seed (or default) flag attempts POST /<collection> using schema-derived body (the same path crud-suite uses for events/topics/templates) to seed at least one record so dependent fixture ids can be captured. Falls back to current 'create one first' message only when POST returns 4xx.
Actual: 121 cells stay blocked by no-fixtures even after --apply on Resend, where /contacts and /automations are empty in a fresh workspace. Tester cannot push past 37% pass-coverage without manually creating resources in product UI — breaks the purely-API loop.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-08.log:159-165 (prepare-fixtures), :230-236 (coverage final)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 miss-empty reason in zond prepare-fixtures (single-pass discover) suggests rerunning with --seed --cascade so the user can auto-create the missing parent resource via POST
- [x] #2 wording change is covered by an existing or new unit/integration test
- [x] #3 bun run check passes
<!-- AC:END -->

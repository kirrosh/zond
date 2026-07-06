---
id: ARV-350
title: >-
  flag unseeded capture-chain roots (e.g. {{account}}) — report, do NOT
  auto-seed
status: Done
assignee: []
created_date: '2026-07-06 13:03'
updated_date: '2026-07-06 13:44'
labels:
  - zond-bug
  - fixtures
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: run 20260706-150730. persons-crud, people-crud, external_accounts-crud each fully skip: "required fixture {{account}} is empty" — the capture-chain root is never provided, so 15 dependent CRUD steps never run.

PHILOSOPHY CONSTRAINT (src/CLAUDE.md litmus): m-24/ARV-336 removed the autonomous seed engine — do NOT re-add auto-POST-create to seed {{account}}. Litmus-correct fix: deterministically DETECT + REPORT an unseeded capture-root as a distinct fixture gap (so the agent/user supplies an account id). Gap-report only, no seeding.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 unseeded capture-chain root surfaced as a distinct, actionable fixture gap
- [ ] #2 NO auto-seed / auto-POST-create added (ARV-336 stays reverted)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done (same module as ARV-349). unseededRoots = required manifest var, empty in env, suite-referenced, seeded by no step. Per-suite capture scoping matches runtime (only setup:true suites share captures) so cross-suite roots like {{account}} (created in crud-accounts, referenced uncaptured in persons-crud) are correctly flagged — verified on live stripe workspace (account now a root; 72/80 required-empty). Report-only, no auto-seed. AC#1 distinct actionable gap ✓ AC#2 no auto-seed ✓.
<!-- SECTION:NOTES:END -->

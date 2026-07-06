---
id: ARV-350
title: >-
  flag unseeded capture-chain roots (e.g. {{account}}) — report, do NOT
  auto-seed
status: To Do
assignee: []
created_date: '2026-07-06 13:03'
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

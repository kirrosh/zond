---
id: ARV-348
title: probe --emit-tests is a silent no-op without --live (+ inconsistent messaging)
status: To Do
assignee: []
created_date: '2026-07-06 13:03'
labels:
  - zond-bug
  - ux
  - probe
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: run 20260706-150730. zond probe mass-assignment --emit-tests (and security ...) exit 0, "Plan: 290 planned", dir stays EMPTY; downstream zond run <probes dir> then prints "No test files found". probe is safe-by-default (needs --live); --emit-tests is skipped with no live verdicts. Worse, messaging is contradictory: line1 "Re-run with --live", line2 "Re-run without --dry-run" (--dry-run was never passed) — misled the agent into misdiagnosis. Skill-drift: probe reads live-by-default in the flow, but CLI is safe-by-default (opposite of zond-scan, which IS live-by-default) — the inversion between adjacent commands is the root confusion.

LITMUS: deterministic UX/consistency fix -> belongs in zond + skill docs. Either emit dry scaffolds in safe mode OR fail loudly ("--emit-tests requires --live"); unify the two flag messages; align probe skill wording to safe-by-default+--live.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 probe --emit-tests either emits dry scaffolds or errors loudly instead of exit 0 + empty dir
- [ ] #2 single consistent --live message (no phantom --dry-run)
- [ ] #3 probe skill template says safe-by-default + --live
<!-- AC:END -->

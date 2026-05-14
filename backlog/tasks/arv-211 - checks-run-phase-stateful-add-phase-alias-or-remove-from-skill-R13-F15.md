---
id: ARV-211
title: 'checks run --phase stateful: add phase alias or remove from skill (R13/F15)'
status: Done
assignee: []
created_date: '2026-05-14 09:25'
updated_date: '2026-05-14 09:27'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 13, finding F15, class missing-feature / stale-CLI, severity HIGH.

Repro:
  zond checks run --api github --phase stateful --report ndjson
  # → Error: Unknown --phase: 'stateful'. Available: examples, coverage, all

Skill .claude/skills/zond-checks/SKILL.md promises --phase stateful that auto-selects the 5 m-20 stateful checks (cross_call_references, idempotency_replay, pagination_invariants, lifecycle_transitions, use_after_free, ensure_resource_availability).

Actual: --phase only accepts examples|coverage|all. The stateful checks exist as individual --check ids but cannot be selected as a group.

Expected: either add --phase stateful that picks up all checks tagged stateful (preferred — matches skill), or update skill to use --check <id,id,id,…>. The CLI side is the cleaner fix because users already invoke other --phase aliases that way.

Impact: blocks DEPTH-PASS 'stateful invariants' step entirely as documented; users must hand-list each check id.

Log: see feedback-13.md F15.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed via two-pronged change: (1) src/cli/commands/checks.ts splitList → expandStatefulAlias() so --check stateful expands to all StatefulCheck registry ids; (2) skill templates (zond.md + zond-checks.md) rewritten --phase stateful → --check stateful. Phase remains case-generation (examples|coverage|all); stateful is now the canonical group keyword in --check.
<!-- SECTION:NOTES:END -->

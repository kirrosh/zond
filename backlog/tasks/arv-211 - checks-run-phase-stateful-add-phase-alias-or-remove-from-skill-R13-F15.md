---
id: ARV-211
title: 'checks run --phase stateful: add phase alias or remove from skill (R13/F15)'
status: Done
assignee: []
created_date: '2026-05-14 09:25'
updated_date: '2026-05-14 11:15'
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
round-02/03 (R-02/F5+SD4): подтверждено повторно. CLI hint работает корректно (ARV-211 fix), но prompt-инструкция в ~/.claude/commands/zond-fb-tester.md всё ещё содержит --phase stateful → новый агент-tester видит exit 2 → переключается на --check stateful по hint'у. Prompt поправлен в этой же сессии (user-side, вне зонда).
<!-- SECTION:NOTES:END -->

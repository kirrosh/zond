---
id: ARV-242
title: 'prepare-fixtures --seed: back-off message when seed-pass produces 0 progress'
status: Done
assignee: []
created_date: '2026-05-14 11:16'
updated_date: '2026-05-14 11:23'
labels:
  - feedback-loop
  - m-16
  - skill-drift
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding SD5, class obsolete-rule/skill-drift
Repro: PAT с узким scope, zond prepare-fixtures --api <name> --apply --cascade --seed
Expected: hint 'seed produced 0 new vars, N endpoint-403; consider --no-seed next iteration'. Или авто-back-off если seed-pass-N даёт 0 progress.
Actual: тратит rate-limit на POST'ы которые гарантированно вернут 403.
Skill drift: zond/SKILL.md:172-174 советует --cascade --seed по умолчанию, что плохо для read-only PAT.
Log: ~/Projects/zond-test/.fb-loop/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 prepare-fixtures human stdout prints hint when seed-pass produced 0 new vars AND majority of seeds failed with 401/403 (suggesting re-run without --seed)
<!-- AC:END -->

---
id: ARV-243
title: 'skill drift: zond-checks page-based pagination short-circuit disclaimer'
status: Done
assignee: []
created_date: '2026-05-14 11:16'
updated_date: '2026-05-14 11:23'
labels:
  - feedback-loop
  - m-16
  - skill-drift
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding SD6, class stale-example/poor-discoverability
Skill: .claude/skills/zond-checks/SKILL.md:316-323 — описывает pagination_invariants и упоминает 'Cursor-style only in this milestone... page/offset/token declarations parse but the check short-circuits', но disclaimer внутри examples, легко промахнуться.
Fix: перенести disclaimer в Phase pre-0 (skill zond-checks/SKILL.md:78) с явным предупреждением.
Log: ~/Projects/zond-test/.fb-loop/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond-checks Phase pre-0 has explicit heads-up that page-based pagination_invariants short-circuits — agent skips dump+apply step
<!-- AC:END -->

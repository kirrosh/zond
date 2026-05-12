---
id: ARV-89
title: >-
  skill drift: zond run --json collision with --report json in zond.md iron
  rules
status: Done
assignee: []
created_date: '2026-05-11 07:50'
updated_date: '2026-05-11 07:52'
labels:
  - feedback-loop
  - skill-drift
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: skill-drift-summary SD6, severity low, drift-type=stale-example. Skill file: src/cli/commands/init/templates/skills/zond.md:57. Current: 'Re-run after each fix with --json'. CLI rejects 'zond run --json' (TASK-134). Fix: replace with --report json.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 iron rule no longer suggests 'zond run --json'; reroutes to --report json [--report-out <file>]
- [x] #2 explanation references TASK-134 collision rationale
<!-- AC:END -->

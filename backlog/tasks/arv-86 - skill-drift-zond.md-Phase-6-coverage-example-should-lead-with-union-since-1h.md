---
id: ARV-86
title: >-
  skill drift: zond.md Phase 6 coverage example should lead with --union
  since:1h
status: Done
assignee: []
created_date: '2026-05-11 07:50'
updated_date: '2026-05-11 07:52'
labels:
  - feedback-loop
  - skill-drift
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: skill-drift-summary SD3, severity medium, drift-type=wrong-default. Skill file: src/cli/commands/init/templates/skills/zond.md L685-693. Current first example is single-run snapshot; tester saw 39% vs 77% after partial run. Fix: lead Phase 6 with --union since:1h example and label bare command as 'single-run snapshot — rarely what you want'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Phase 6 example block leads with --union since:1h / --union session as recommended default
- [x] #2 bare 'zond coverage --api X' command is labelled as single-run snapshot, with auto-union promotion note (ARV-71)
<!-- AC:END -->

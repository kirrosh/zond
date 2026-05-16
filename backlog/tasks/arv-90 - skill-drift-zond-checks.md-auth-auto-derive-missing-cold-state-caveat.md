---
id: ARV-90
title: 'skill drift: zond-checks.md auth auto-derive missing cold-state caveat'
status: To Do
assignee: []
created_date: '2026-05-11 07:50'
updated_date: '2026-05-16 07:35'
labels:
  - feedback-loop
  - skill-drift
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: skill-drift-summary SD7, severity medium, drift-type=missing-caveat. Skill file: src/cli/commands/init/templates/skills/zond-checks.md:49-51. F1/F18 cold-state race: on fresh workspace first zond checks run got 83×401. Fix: add prewarm note 'after fresh zond add api, run one zond run --safe before zond checks run'.
<!-- SECTION:DESCRIPTION:END -->

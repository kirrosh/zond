---
id: ARV-92
title: >-
  skill drift: zond-triage skill not referenced from primary workflow in zond.md
  / zond-base.md
status: To Do
assignee: []
created_date: '2026-05-11 07:50'
labels:
  - feedback-loop
  - skill-drift
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: skill-drift-summary SD9, severity medium, drift-type=process-drift. Skill file: src/cli/commands/init/templates/skills/zond-triage.md (whole) + xref from zond.md / zond-base.md. Tester parsed run-NN.json with jq instead of delegating to Skill(zond-triage). Fix: add 'after zond run with failures, delegate to Skill(zond-triage) — it routes by recommended_action enum' in primary workflow skills.
<!-- SECTION:DESCRIPTION:END -->

---
id: ARV-88
title: 'skill drift: report_backend_bug → STOP iron rule wrong for autonomous mode'
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
Source: skill-drift-summary SD5, severity medium, drift-type=obsolete-rule. Skill file: src/cli/commands/init/templates/skills/zond.md L46. Current iron rule: STOP on first report_backend_bug or 5xx. Autonomous/loop mode needs continue + log to api-bugs-NN.md. Fix: split rule by mode (interactive vs autonomous).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 iron rule splits report_backend_bug → STOP into interactive vs autonomous/loop semantics
- [x] #2 autonomous mode logs to api-bugs-NN.md and does NOT mask via expect:
<!-- AC:END -->

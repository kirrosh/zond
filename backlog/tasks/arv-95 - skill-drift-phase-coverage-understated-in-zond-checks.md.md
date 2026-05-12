---
id: ARV-95
title: 'skill drift: --phase coverage understated in zond-checks.md'
status: To Do
assignee: []
created_date: '2026-05-11 07:50'
labels:
  - feedback-loop
  - skill-drift
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: skill-drift-summary SD12, severity low, drift-type=understated-impact. Skill file: src/cli/commands/init/templates/skills/zond-checks.md:96-99. Current: '--phase coverage — deterministic boundary values'. Actual: ×1.75 cases, real HIGH findings. Fix: strengthen prose 'Run --phase coverage for real bug hunting; --phase examples is smoke (5x faster, 3x less coverage, ~zero HIGH findings on well-formed APIs)'.
<!-- SECTION:DESCRIPTION:END -->

---
id: ARV-95
title: 'skill drift: --phase coverage understated in zond-checks.md'
status: Done
assignee: []
created_date: '2026-05-11 07:50'
updated_date: '2026-05-16 08:21'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Strengthened --phase coverage prose in zond-checks.md Scoping section. New language: 'examples is smoke, not depth — finishes 3x faster, zero HIGH findings on well-formed APIs because boundary mutations never fire. coverage expands to ~x1.75 cases per op with deterministic boundary values. Use examples for fast CI gate, coverage once before sign-off.'
<!-- SECTION:NOTES:END -->

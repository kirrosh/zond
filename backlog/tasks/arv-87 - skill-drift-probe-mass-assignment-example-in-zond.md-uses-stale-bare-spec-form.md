---
id: ARV-87
title: >-
  skill drift: probe mass-assignment example in zond.md uses stale bare-spec
  form
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
Source: skill-drift-summary SD4, severity medium, drift-type=stale-example. Skill file: src/cli/commands/init/templates/skills/zond.md L441-443. Current: 'zond probe mass-assignment apis/<api>/spec.json --env apis/<api>/.env.yaml --output … --emit-tests …'. Replace with 'zond probe mass-assignment --api <name> --emit-tests … --output …'. Same fix for probe security.
<!-- SECTION:DESCRIPTION:END -->

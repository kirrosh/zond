---
id: ARV-91
title: 'skill drift: zond-checks.md catalog missing per-check noise caveats'
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
Source: skill-drift-summary SD8, severity medium, drift-type=missing-caveat. Skill file: src/cli/commands/init/templates/skills/zond-checks.md catalog. positive_data_acceptance gave 171 false-positive 422 on Resend (semantic validation). Fix: per-check footer 'noisy on APIs with semantic validation; treat 422 as fix_generator, not report_backend_bug' for positive_data_acceptance + similar for response_schema_conformance (format-only fields).
<!-- SECTION:DESCRIPTION:END -->

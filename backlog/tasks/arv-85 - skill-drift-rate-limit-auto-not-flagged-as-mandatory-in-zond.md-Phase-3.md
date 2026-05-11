---
id: ARV-85
title: 'skill drift: --rate-limit auto not flagged as mandatory in zond.md Phase 3'
status: Done
assignee: []
created_date: '2026-05-11 07:50'
updated_date: '2026-05-11 07:52'
labels:
  - feedback-loop
  - skill-drift
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: skill-drift-summary SD2, severity high, drift-type=missing-flag. Skill file: src/cli/commands/init/templates/skills/zond.md Phase 3 (Run). After ARV-64 adaptive is default but skill doesn't say so. Tester hit 308×429 (22% of requests) bare-runs. Fix: Phase 3 note 'if API publishes RateLimit-Policy, ensure --rate-limit auto (now default after ARV-64).'
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Phase 3 (Run) explicitly states that --rate-limit auto is the default after ARV-64
- [x] #2 fallback paths for older binaries / 429-storm scenarios are listed
<!-- AC:END -->

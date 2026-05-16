---
id: ARV-93
title: 'skill drift: zond.md audit Phase 7 missing 4 known-gotchas footer'
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
Source: skill-drift-summary SD10, severity medium, drift-type=missing-caveat. Skill file: src/cli/commands/init/templates/skills/zond.md L757-781. zond audit gotchas: (1) overwrites user session (F5), (2) exit 0 on failed stages (F6), (3) audit-report.html path not surfaced (F22), (4) needs --rate-limit auto on rate-limited APIs. Fix: append 'Known gotchas' subsection in Phase 7.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 audit Phase 7 has a 'Known gotchas' subsection covering 4 items: session-overwrite, exit-0-on-fail, html path, rate-limit propagation
- [x] #2 each gotcha cross-references the relevant ARV ticket where applicable
<!-- AC:END -->

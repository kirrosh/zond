---
id: ARV-84
title: 'skill drift: zond.md missing Phase 1.5 (zond check spec)'
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
Source: skill-drift-summary SD1, severity high, drift-type=gap. Skill file: src/cli/commands/init/templates/skills/zond.md (Phase 1 → Phase 2 jump). Missing: 'zond check spec --api X' static audit phase. Impact: 181 spec issues miss tester eyes. Fix: insert Phase 1.5 with zond check spec invocation between Orient and Generate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond.md has a Phase 1.5 section between Orient and Generate
- [x] #2 Phase 1.5 invokes 'zond check spec --api <name>' with rationale for cheap-pre-depth-check ordering
<!-- AC:END -->

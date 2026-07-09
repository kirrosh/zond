---
id: ARV-390
title: zond init cold-start UX for a stranger's repo (no 'you are me' assumptions)
status: To Do
assignee: []
created_date: '2026-07-09 12:56'
labels:
  - m-27
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cold-start init assumes author context. Verify the path install → init → doctor → first `audit --safe` under 5 min on an unfamiliar repo. First screen must tell what to fill in .env.yaml and where to go next. Split out from the cold-start tail of old ARV-365.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A stranger reaches a first green `audit --safe` without editing internals or reading source
- [ ] #2 init/doctor output points at the exact next action (fill env / run audit)
<!-- AC:END -->

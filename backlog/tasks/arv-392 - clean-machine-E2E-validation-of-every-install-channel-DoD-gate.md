---
id: ARV-392
title: clean-machine E2E validation of every install channel (DoD gate)
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
Prove distribution works for a stranger: fresh container/VM per channel (curl, npm, brew, win) → install → zond init on a public repo → first audit with zero internal knowledge. Record every friction point; friction = channel bug.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 curl | sh, npm i -g, brew install, win installer each verified on a clean environment
- [ ] #2 Friction log captured and each item filed or fixed
<!-- AC:END -->

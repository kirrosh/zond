---
id: ARV-234
title: 'coverage --union session: graceful fallback when last session just ended'
status: To Do
assignee: []
created_date: '2026-05-14 11:16'
labels:
  - feedback-loop
  - api-github
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F7, class quirk
Repro: zond session start && zond run ... && zond session end && zond coverage --api github --union session
Expected: использовать последнюю активную session_id или предупредить (session ended N min ago, did you mean --session-id <id>?)
Actual: 'Error: --union session requires an active session'
Log: ~/Projects/zond-test/.fb-loop/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->

---
id: ARV-246
title: 'probe security digest: HIGH-finding должен показывать full request payload'
status: To Do
assignee: []
created_date: '2026-05-15 05:42'
labels:
  - feedback-loop
  - api-github
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F17, class missing-feature
Repro: S1 finding содержит только 'zond-safe%0d%0aX-Zond-Injected: yes' без полного body. Чтобы reproduce на чужом repo нужен curl-эквивалент.
Expected: рядом с HIGH finding — zond request repro: 'zond request PATCH /repos/{owner}/{repo} --api github --json '{...}''
Actual: payload не показан.
Log: ~/Projects/zond-test/.fb-loop/rounds/api-bugs-04.md
<!-- SECTION:DESCRIPTION:END -->

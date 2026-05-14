---
id: ARV-199
title: 'run: --learn-apply should imply --learn (or suggest it in error) (F16)'
status: To Do
assignee: []
created_date: '2026-05-14 08:09'
labels:
  - feedback-loop
  - api-stripe
  - m-21
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 07, finding F16, class ux-papercut.

Repro:
  zond run apis/stripe/tests --safe --learn-apply --learn-target drifts

Expected: either (a) --learn-apply implicitly enables --learn, or (b) the error message guides the user to add --learn.

Actual: hard error 'Error: --learn-apply requires --learn'. Pattern in other tools usually allows --apply alone (cf. 'git stash apply').

Workaround: always pass both flags: --learn --learn-apply --learn-target drifts.

Log: $HANDOFF/rounds/raw-07.log
<!-- SECTION:DESCRIPTION:END -->

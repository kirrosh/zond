---
id: ARV-160
title: >-
  skill: add zond-max-coverage SKILL.md (depth-pass open-list,
  workaround-mindset, audit-as-checklist)
status: To Do
assignee: []
created_date: '2026-05-12 11:14'
labels:
  - feedback-loop
  - skill-drift
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 05, mission discipline gaps notes

Tester articulated 4 patterns explaining why R02-R04 didn't hit the max-coverage ceiling:
1. Depth-pass in skill is closed-list — only mentions check spec/checks run/probe mass-assignment/probe security/run --validate-schema. Doesn't surface probe static, audit, db diagnose, run --learn.
2. Deferred findings → tester goes 'wait for fix' instead of 'find workaround' (e.g. F4 form-encoded had a 1-min --header Content-Type: application/x-www-form-urlencoded workaround).
3. Iteration budget (4 rounds) pushes narrow --include scopes; full-spec runs in background would yield more.
4. Skills serve as reference, not checklist — no mechanism for 'must touch each command class'.

Tester drafted .claude/skills/zond-max-coverage/SKILL.md in their workspace; needs review + adoption into src/cli/commands/init/templates/skills/.

Not a quick-fix; defer to skill-author session.
<!-- SECTION:DESCRIPTION:END -->

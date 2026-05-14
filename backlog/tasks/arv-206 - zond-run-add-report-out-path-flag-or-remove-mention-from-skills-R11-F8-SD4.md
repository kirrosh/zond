---
id: ARV-206
title: >-
  zond run: add --report-out <path> flag (or remove mention from skills)
  (R11/F8/SD4)
status: To Do
assignee: []
created_date: '2026-05-14 08:22'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 11, finding F8 + skill-drift SD4, class missing-feature / ux-papercut, severity LOW.

Repro:
  zond run apis/github/tests/_smoke_user.yaml --report json --report-out run-11.json
  # → error: unknown option '--report-out'

Expected: either add --report-out so the JSON/NDJSON report is written to <path> (so skills/round-prompts don't have to use shell-redirect), or remove the mention from .claude/ralph-loop.local.md and zond-fb-tester instructions.

Actual: flag absent; only shell redirect (> run-NN.json) works. Skill instructions promise the flag — breaks scripted artifact bundling under .fb-loop/rounds/.

Log: see feedback-11.md F8.
<!-- SECTION:DESCRIPTION:END -->

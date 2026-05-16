---
id: ARV-228
title: >-
  db diagnose --json: by_recommended_action.examples shape mismatch with skill
  (R17/F33/SD22)
status: To Do
assignee: []
created_date: '2026-05-14 10:12'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 17, finding F33 + skill-drift SD22, class likely_bug / ux-papercut, severity MEDIUM.

Repro:
  zond db diagnose --api github --json | jq '.data.by_recommended_action.fix_auth_config'
  # → { count: 4, examples: ['github-smoke-extended/GetNotifications', ...] }

skill .claude/skills/zond-triage/SKILL.md routes through this envelope but expects examples to be a list of {suite, step, path, method, failure_reason, recommended_fix} objects. Agents that triage on path/method break.

Fix: either expand examples to object shape, or update skill to call examples 'short ids' and direct agents to zond db diagnose --run <id> --verbose for details.

Also SD22: skill shows by_recommended_action as array {action, count, examples}, real is object keyed by enum.

Log: see feedback-17.md F33 + SD22.
<!-- SECTION:DESCRIPTION:END -->

---
id: ARV-219
title: >-
  lifecycle_transitions: support pure-observation (no 'actions' annotation)
  (R15/F23)
status: To Do
assignee: []
created_date: '2026-05-14 10:08'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 15, finding F23, class ux-papercut / missing-feature, severity MEDIUM.

Repro:
  # apply lifecycle WITHOUT actions (schema marks actions optional)
  zond api annotate apply --api github --lifecycle --input lc.yaml --yes
  zond checks run --api github --check lifecycle_transitions --include 'path:^/agents/tasks' --report ndjson
  # → skipped_outcomes: 'lifecycle_transitions: lifecycle has no actions to verify' ×1

Expected: either (a) annotate apply rejects lifecycle without actions (treat actions as required in the schema validator), or (b) the check supports a pure-observation mode — walk the list endpoint and assert observed states ∈ declared states, observed transitions ⊆ declared transitions.

Actual: silent skip with reason 'no actions to verify'. User sees 'success writes' from annotate apply and assumes the check works.

Skill .claude/skills/zond-checks/SKILL.md should also explicitly note that actions are effectively required (or change schema).

Log: see feedback-15.md F23.
<!-- SECTION:DESCRIPTION:END -->

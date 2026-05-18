---
id: ARV-219
title: >-
  lifecycle_transitions: support pure-observation (no 'actions' annotation)
  (R15/F23)
status: Done
assignee: []
created_date: '2026-05-14 10:08'
updated_date: '2026-05-16 09:06'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented pure-observation mode in lifecycle_transitions (m-21).

When cfg.actions is empty AND g.list exists, the check switches modes:
- GET list once, walk items, assert each observed cfg.field value ∈ cfg.states
- Reports single finding 'undeclared_state' per resource with per-state sample ids (up to 5), mode='observation', items_examined count
- Cannot verify transitions[] (no time series in single list call) — documented as a limitation

Skip paths: list non-2xx (broken-baseline), empty list, unrecognised body shape, field missing on every item (yaml mismatch hint).

Wiring: applies(g) loosened to (create+read) OR list; run() branches before action-mode begins. Action-mode path now also skips with explicit reason when actions declared but create+read missing.

annotate skill (lifecycle.ts EXPECTED_OUTPUT_SHAPE) now tells agent that actions:{} triggers observation mode (was silently skipped before — this was the F23 papercut).

Tests: 9 new observation cases (lifecycle-transitions.test.ts) — pass, undeclared_state with dedup+sample_id_cap, empty list skip, 5xx skip, all-items-missing-field skip, bad-shape skip, no-list-no-actions skip, sample_id fallback to 'number' (GitHub Issues shape), action-mode without create+read skip. All 26 tests green; 2207/2207 unit tests pass; tsc --noEmit clean.

Skill template (zond-checks.md): documented two modes with when-to-use, observation limitations, and a new yaml example.
<!-- SECTION:NOTES:END -->

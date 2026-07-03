---
id: ARV-160
title: >-
  skill: add zond-max-coverage SKILL.md (depth-pass open-list,
  workaround-mindset, audit-as-checklist)
status: Done
assignee: []
created_date: '2026-05-12 11:14'
updated_date: '2026-05-16 08:21'
labels:
  - wont-do
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
WONT DO — rejected after review of tester draft at ~/Projects/zond-test/.claude/skills/zond-max-coverage/SKILL.md (350 lines).

Two reasons:

1. Strategy conflict (R18 pivot, 2026-05-15): zond positioning is now 'API hygiene scanner for small teams, NOT bounty tool; no evidence then no high severity'. Draft is framed as bounty mentality — найди потолок покрытия, max-coverage ceiling, reached ceiling because blocker. Adopting reverses the pivot.

2. Stale content: draft references retired/resolved items:
   - Read zond-base first (zond-base + zond-scenarios consolidated into zond)
   - F4 deferred no form flag workaround (ARV-149 Done, --form exists)
   - F6 mass-assignment skips form (ARV-150 Done, form-encoded supported)
   - --report-out flag (legacy, replaced by --output / --report)
   - checks list — 12 checks (current count is 18)
   Re-authoring would touch every section.

Salvageable substance (fold into zond.md later if needed, NOT separate skill):
- Enumerate full CLI surface via --help before assuming depth-pass scope
- Background long sweeps
- Didnt run because X as explicit finding, not absence
- Discipline checklist

Standalone skill adds maintenance burden plus framing conflict — not worth it now.
<!-- SECTION:NOTES:END -->

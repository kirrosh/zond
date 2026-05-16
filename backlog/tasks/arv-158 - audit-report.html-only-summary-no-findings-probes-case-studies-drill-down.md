---
id: ARV-158
title: 'audit-report.html: only summary, no findings/probes/case-studies drill-down'
status: To Do
assignee: []
created_date: '2026-05-12 11:11'
updated_date: '2026-05-16 07:35'
labels:
  - feedback-loop
  - api-stripe
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 05, finding F12, class missing-feature/ux-papercut

Repro: zond audit --api stripe --with-mass-assignment --with-security --out audit-05.html
Expected: HTML report contains stage table + coverage breakdown + per-stage findings list (per .claude/skills/zond/SKILL.md:826 'stages table + coverage summary + links to zond report export <run-id>'). Skill promises per-stage drill-down.
Actual: 2911 bytes total. Text summary only ('3 failed stages'). No markup sections for findings/probes/case-studies.
Effect: user sees '3 failed' but not WHICH 271 findings, schema violations, etc. Has to dig via zond db runs --limit 5 → zond report export <run-id> manually. Skill Phase 7 doesn't make this explicit.

Either: (a) inline per-stage findings into audit HTML, or (b) explicitly document that audit-report is summary-only and link to per-run drill-down commands.

Log: $HANDOFF/rounds/audit-05.html (3KB total), $HANDOFF/rounds/raw-05-audit.log
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Deferred: requires HTML template work (per-stage findings rendering) — separate session. Tester workaround: zond db runs --limit 5 → zond report export <run-id>.
<!-- SECTION:NOTES:END -->

---
id: ARV-158
title: 'audit-report.html: only summary, no findings/probes/case-studies drill-down'
status: Done
assignee: []
created_date: '2026-05-12 11:11'
updated_date: '2026-05-16 08:05'
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

Closed in m-22 validation sprint 2026-05-16.

Implementation:
- src/cli/commands/audit.ts:
  * After стадии complete: listSessions(1) → находим аудит-сессию → listRunsBySession() → для каждого failed run вызываем diagnoseRun() → собираем 'drilldown' массив в ReportInput.
  * writeAuditReport: новая 'Failures by run' секция с <details> per run, summary в <summary>, by_recommended_action buckets (count + первый example с method/path/status/reason) + multiple-examples '(+N more)' hint, env_issue banner если present, concrete commands (zond db diagnose --run-id N --json, zond report export N).
  * Buckets сортируются по priority order из zond-triage skill (report_backend_bug → fix_spec → fix_auth_config → ...).
  * CSS: <details>, ul.buckets, p.cmds, .muted styles.
  * Static 'Drill-down' секция в конце упрощена (re-run audit + db runs --limit + report export <id>) — concrete run-id'ы теперь внутри details.
  * Экспортированы writeAuditReport + ReportInput для unit-теста.

- src/cli/commands/init/templates/skills/zond.md: после описания audit добавлена секция о per-run drill-down в HTML.

- tests/cli/audit-html-drilldown.test.ts (NEW, 5 tests):
  - empty drilldown → 'Failures by run' не появляется (back-compat)
  - 1 failed run → <details> + bucket rows + run-id command
  - buckets ordered by skill priority (backend → auth)
  - env_issue banner внутри details
  - multiple runs → multiple <details> blocks

Defaults к degraded behaviour когда DB unreachable (listSessions throws) — HTML рендерится без 'Failures by run' секции, как до этого изменения.

Resolved both options of ARV-158 hybrid-style:
- (a) Inlined per-stage findings: by_recommended_action buckets с examples
- (b) Documented per-run drill-down commands: concrete run-id'ы в HTML вместо абстрактного <run-id>

Все 2189 unit-тестов зелёные.
<!-- SECTION:NOTES:END -->

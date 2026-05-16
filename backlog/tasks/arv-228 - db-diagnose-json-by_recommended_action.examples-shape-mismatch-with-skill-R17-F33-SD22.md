---
id: ARV-228
title: >-
  db diagnose --json: by_recommended_action.examples shape mismatch with skill
  (R17/F33/SD22)
status: Done
assignee: []
created_date: '2026-05-14 10:12'
updated_date: '2026-05-16 07:59'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: high
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed in m-22 validation sprint 2026-05-16.

Implementation:
- src/core/diagnostics/db-analysis.ts: DiagnoseResult.by_recommended_action[].examples changed from string[] to Array<{suite, test, method, path, status, reason?}>. Reason trimmed to 120 chars; full error_message stays in failures[].error_message. Nullable DB columns (request_method, request_url, response_status могут быть null на early steps) coerced to '' / 0 на boundary.
- src/cli/commands/init/templates/skills/zond-triage.md: добавил новую секцию 'Shortcut: by_recommended_action envelope (ARV-101/ARV-228)' с актуальным shape и priority-order iteration guide. Skill ранее не описывал этот envelope вообще.
- tests/diagnostics/env-issue-override.test.ts: обновил existing test чтобы проверять object shape вместо <suite>/<test> regex.

Resolved both parts of ARV-228:
- (a) Examples shape: was string[], now object[] carrying method/path/status/reason. Agents триажат на path/method без cross-joining failures[].
- (b) SD22 array-vs-object: skill ранее не упоминал by_recommended_action; новая секция документирует object-keyed-by-enum форму (count + examples), eliminating future drift potential.

Verified e2e: zond db diagnose --run-id 4 --json | jq '.data.by_recommended_action.fix_test_logic.examples[0]' returns {suite, test, method, path, status} object.
<!-- SECTION:NOTES:END -->

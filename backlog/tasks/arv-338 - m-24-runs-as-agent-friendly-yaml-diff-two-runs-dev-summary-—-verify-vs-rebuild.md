---
id: ARV-338
title: >-
  m-24 runs as agent-friendly yaml + diff two runs + dev summary — verify vs
  rebuild
status: Done
assignee: []
created_date: '2026-07-06 07:14'
updated_date: '2026-07-06 08:45'
labels:
  - m-24
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Goal capability: store each run in yaml an agent can read to assemble/compare suites; a diff of two runs (esp. after an API change); a developer-facing summary. Check what already exists (coverage, schema-from-runs, db diagnose) and reshape rather than rebuild. Ponytail: reuse before writing new.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done as scope 1+2 (2026-07-06): (1) db diagnose reshaped — prose hint layer removed (agent_directive, env_issue clustering TASK-70/98, auth_hint, per-failure hint/schema_hint, statusHint/envHint/softDeleteHint/schemaHint); agent routes by recommended_action enum + raw evidence. (2) --report yaml added to db run / db diagnose / db compare — same payload as YAML for agent-readable run snapshots and text diffs. Item 3 (field-level body/schema run-diff) split into follow-up task.
<!-- SECTION:NOTES:END -->

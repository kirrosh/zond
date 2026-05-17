---
id: ARV-261
title: 'prepare-fixtures: --seed hint blanket recommended even against production APIs'
status: Done
assignee: []
created_date: '2026-05-17 06:50'
updated_date: '2026-05-17 06:54'
labels:
  - ux
  - prepare-fixtures
  - safety
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
For 8+ vars where list endpoint returned `[]`, output reads:
```
failed:list-empty  no <resource> in target API — re-run with `zond prepare-fixtures --api <name> --seed --apply` to POST-create one automatically
```

In a scan context against `api.github.com` (or any production API), `--seed` would POST-create real resources under the user's account.

Discovered: zond-scan on GitHub public REST API, 2026-05-17.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add safety prefix to --seed hint mentioning destructive nature
- [ ] #2 OR detect production-like base_url heuristics (api.*, www.*) and downgrade --seed hint
- [ ] #3 Document --seed risks in zond/SKILL.md fixture-bootstrap section
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in src/cli/commands/discover.ts:680-691. miss-empty hint now embeds ⚠-prefixed warning: '⚠ creates real resources on the target API — use only against a throwaway/test environment'. Verified on github workspace: 5 miss-empty entries (classrooms, deployments, ghsa, gists, databases) all carry the new prefix. discovered: 2026-05-17 zond-scan github run.
<!-- SECTION:NOTES:END -->

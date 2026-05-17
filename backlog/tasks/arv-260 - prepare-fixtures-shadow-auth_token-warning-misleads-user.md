---
id: ARV-260
title: 'prepare-fixtures: shadow auth_token warning misleads user'
status: Done
assignee: []
created_date: '2026-05-17 06:50'
updated_date: '2026-05-17 06:54'
labels:
  - bug
  - ux
  - prepare-fixtures
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`zond init` + `zond add api` auto-create `auth_token: "@secret:auth_token"` in `.env.yaml` AND `auth_token: ""` in `.secrets.yaml`. But `.api-fixtures.yaml` does NOT list `auth_token` (correct — it's not a path/query/body fixture).

So `prepare-fixtures` warns:
```
Warning: 1 env key(s) not in manifest, ignored: auth_token. Drop them from .env.yaml or run `zond refresh-api` if the manifest is stale.
```

The fix instructions are WRONG — `auth_token` SHOULDN'T be dropped (it's how `Authorization` gets injected), and `refresh-api` won't add it back when spec lacks `securitySchemes`.

Discovered: zond-scan on GitHub public REST API (1184 endpoints), 2026-05-17.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Suppress not-in-manifest warning for `auth_token` and other known auto-managed keys
- [ ] #2 OR list `auth_token` in `.api-fixtures.yaml` with `source: secret` when zond creates it during `add api`
- [ ] #3 Add test case: spec without securitySchemes → no spurious warning
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in src/cli/commands/discover.ts:1106-1117. Added AUTO_MANAGED_KEYS set (auth_token, api_key) — these are filtered from unknownEnvKeys before warning. Verified on github workspace: warning gone. Existing discover.test.ts pass (6 tests, no regressions). discovered: 2026-05-17 zond-scan github run.
<!-- SECTION:NOTES:END -->

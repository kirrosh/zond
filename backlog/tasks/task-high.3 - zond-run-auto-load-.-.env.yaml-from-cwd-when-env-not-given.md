---
id: TASK-HIGH.3
title: 'zond run: auto-load ./.env.yaml from cwd when --env not given'
status: Done
assignee: []
created_date: '2026-04-28 08:14'
updated_date: '2026-04-28 08:40'
labels:
  - bug-hunting
  - from-iteration-3
dependencies: []
parent_task_id: TASK-HIGH
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Context: APPLY agent ran 'cd ~/Projects/resend-tests/apis/resend && bun run --cwd ~/Projects/zond zond -- run /abs/path …'. The collection's ./.env.yaml (with base_url + auth_token) was NOT loaded, so {{base_url}} stayed unsubstituted and 100% of steps errored with 'base_url is not configured'. Required workaround: explicit --env-var base_url=https://api.resend.com plus --auth-token. Observation: --env <name> only looks up .env.<name>.yaml; there is no zero-arg default for plain .env.yaml in cwd. Suggested fix: when --env is unset AND $PWD/.env.yaml exists, load it as the default env file (with a one-line stderr notice 'using ./.env.yaml'). Alternative: --api-collection <dir> flag that resolves env + base + token from a known layout. Unblocks the auto-loop: APPLY agents stop needing per-collection magic incantations.
<!-- SECTION:DESCRIPTION:END -->

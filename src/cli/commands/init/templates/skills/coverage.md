---
name: zond-coverage
description: |
  Maximize API test coverage from an OpenAPI spec with zond. Use when asked to:
  cover endpoints, generate API tests, raise coverage, add tests for new endpoints,
  reach a coverage target, sync tests after spec changes. Activates on:
  openapi.json, openapi.yaml, swagger.json, .api-catalog.yaml, "test coverage",
  "cover this API", "generate tests".
allowed-tools: [Read, Write, Bash(zond *), Bash(bunx zond *)]
---

# zond — API Coverage from OpenAPI

CLI-only skill. zond is invoked directly via shell. Run `zond --version` first;
if missing, install via `curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh`.

## Goal
Drive endpoint coverage from `untested` → `smoke` → `full` for every operation in the spec.

## Critical rules
- **NEVER** open OpenAPI/Swagger files with Read/cat/grep — use `zond describe`,
  `zond catalog`, or the generated `.api-catalog.yaml`.
- **NEVER** write test YAML from scratch — start with `zond generate`, then edit failures.
- **NEVER** run broad CRUD before sanity passes — gate with `--tag sanity --json`.
- **`--safe` enforces GET-only** — required for first-pass smoke against unknown envs.
- **5xx in any run is a bug candidate** — never edit `expect: status` to mask it
  (see `zond-diagnose`).
- For multi-suite tag filters, always include the setup tag: `--tag crud,setup`.
- Captures are file-scoped — pass auth across suites via a `setup: true` suite.

## End-to-end workflow
```bash
# 0. Workspace + register API (idempotent)
zond init --with-spec <spec> --name <name> [--base-url <url>]
zond use <name>

# 1. Endpoint discovery (do NOT read the raw spec)
zond catalog <spec> --output apis/<name>/tests   # writes .api-catalog.yaml
zond describe <spec> --compact                   # quick overview
zond guide <spec> --tests-dir apis/<name>/tests  # uncovered + suggestions

# 2. Generate suites
zond generate <spec> --output apis/<name>/tests              # all
zond generate <spec> --output apis/<name>/tests --tag <tag>  # by spec tag
zond generate <spec> --output apis/<name>/tests --uncovered-only

# 3. Lint + sanity gate (must pass before broad runs)
zond validate apis/<name>/tests
zond run apis/<name>/tests --tag sanity --json

# 4. Smoke (GET-only)
zond run apis/<name>/tests --safe --json

# 5. Full CRUD — only after setup-token capture works
zond run apis/<name>/tests --tag crud,setup --json

# 6. Coverage report — gate at the desired threshold
zond coverage --api <name> --fail-on-coverage 80
zond coverage --api <name> --run-id <id>          # per-run breakdown

# 7. Spec drift — add tests for new endpoints, flag removed
zond sync <spec> --tests apis/<name>/tests
```

## Raising coverage on existing tests
1. `zond coverage --api <name>` → list `untested` endpoints.
2. `zond generate <spec> --uncovered-only --output apis/<name>/tests` to fill gaps.
3. `zond validate` → `zond run --tag sanity` → fix → `--safe` → full.
4. For endpoints flagged `smoke` (only GET), promote to `full` by adding CRUD
   suites via `zond generate --tag <op-tag>` or hand-editing the generated YAML.

## Auth / environments
- Tokens go in `apis/<name>/.env.yaml` (auto-gitignored), referenced as `{{auth_token}}`.
- For login-flow tokens use a `setup: true` suite — captures propagate to later suites
  in the same run. See `apis/<name>/tests/setup.yaml` examples emitted by `zond generate`.
- `zond run --env <name>` loads `.env.<name>.yaml` from the API directory.

## When to hand off
- A failing run with mixed root causes → `zond-diagnose`.
- A user-journey or multi-step flow that `generate` can't express → `zond-scenarios`.

For YAML format (assertions, generators, captures, `always: true` cleanup), see
`ZOND.md` at the repo root or `zond run --help`.

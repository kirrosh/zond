---
name: api-testing
description: |
  API testing with zond. Use when asked to: test API, cover endpoints,
  run smoke tests, analyze API coverage, diagnose test failures,
  set up API test infrastructure, generate CI for API tests.
  Also activates on: openapi.json, swagger, API spec, test coverage.
allowed-tools: [Read, Write, Bash(zond *)]
---

# Zond API Testing

Thin orchestrator. Full content lives in MCP resources — read those first.

## Setup
Run `/zond:setup` first if zond is not installed (`zond --version`).

## Resources to fetch
- `zond://workflow/test-api` — end-to-end workflow (init → catalog → generate → sanity → coverage levels → smoke → CRUD → gaps)
- `zond://rules/never` — MANDATORY NEVER (read before any action)
- `zond://rules/safety` — `--safe` / `--dry-run` / environment gating
- `zond://reference/yaml` — YAML format for editing/fixing tests
- `zond://reference/auth-patterns` — `setup.yaml`, in-memory tokens, multi-user
- `zond://catalog/{api}` — current API catalog (yaml)

## MCP tools
- `zond_init` — register API collection
- `zond_catalog`, `zond_describe` — endpoint discovery
- `zond_run` — execute YAML suites; returns `runId`
- `zond_diagnose` — failures by `runId` (json) — also see `zond://run/{id}/diagnosis` for markdown
- `zond_db_runs`, `zond_db_run` — list/inspect past runs
- `zond_validate`, `zond_coverage`, `zond_sync` — checks and incremental updates
- `zond_request` — ad-hoc HTTP for debugging single endpoints

## Critical rules (always-on, even without MCP)
- **NEVER read OpenAPI/Swagger/JSON spec files** with Read/cat — use `.api-catalog.yaml`, `zond_describe`, or `zond://catalog/{api}`
- **NEVER use curl/wget** — use `zond request` / `zond_request`
- **NEVER write test YAML from scratch** — start with `zond generate`, then edit failures
- **NEVER hardcode tokens for in-memory servers** — use `setup.yaml` with `setup: true`
- **`--tag <group>` filters suites by tag** — always include the setup suite's tag (e.g. `--tag crud,setup`)
- **`recommended_action: report_backend_bug` → STOP**, do not modify the test

## Quickstart
```bash
zond init --name <name> --spec <path> [--base-url <url>]
zond run <tests-dir> --tag sanity --json     # gate before generating broadly
zond run <tests-dir> --safe --json           # smoke tests
zond db diagnose <run-id> --json             # on failure
```

For anything beyond this, fetch `zond://workflow/test-api`.

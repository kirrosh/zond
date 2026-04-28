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

CLI-only skill. zond is invoked directly via shell — no daemon, no transport.

## Setup
Run `/zond:setup` first if zond is not installed (`zond --version`).

## CLI commands
- `zond init --name <name> --spec <path>` — register API collection
- `zond catalog <spec> --output <tests-dir>` — endpoint discovery (`.api-catalog.yaml`)
- `zond describe <spec>` — list endpoints (compact view)
- `zond generate <spec> --output <tests-dir>` — produce smoke + CRUD YAML suites
- `zond run <tests-dir> [--safe] [--tag <t>] [--json]` — execute suites; returns `runId`
- `zond db runs --limit 5 --json` — list recent runs
- `zond db run <id> [--status 403] [--method POST] --json` — inspect a run
- `zond db diagnose <id> --json` — failures grouped by root cause
- `zond probe-validation <spec> --output bugs/probes/` — generate negative-input probes
- `zond probe-methods <spec> --output bugs/methods/` — 405-completeness probes
- `zond validate <tests-dir>` — YAML lint
- `zond coverage --spec <path> --tests <dir>` — endpoint coverage report
- `zond sync <spec> --tests <dir>` — incremental updates from spec
- `zond request <method> <url>` — ad-hoc HTTP for debugging

## Critical rules
- **NEVER read OpenAPI/Swagger/JSON spec files** with Read/cat — use `.api-catalog.yaml` (from `zond catalog`) or `zond describe`
- **NEVER use curl/wget** — use `zond request`
- **NEVER write test YAML from scratch** — start with `zond generate`, then edit failures
- **NEVER hardcode tokens for in-memory servers** — use `setup.yaml` with `setup: true`
- **`--tag <group>` filters suites by tag** — always include the setup suite's tag (e.g. `--tag crud,setup`)
- **`recommended_action: report_backend_bug` → STOP**, do not modify the test
- **5xx in probe runs → bug candidate** — never modify `expect: status` to mask it

## Quickstart
```bash
zond init --name <name> --spec <path> [--base-url <url>]
zond run <tests-dir> --tag sanity --json     # gate before generating broadly
zond run <tests-dir> --safe --json           # smoke tests
zond db diagnose <run-id> --json             # on failure
```

## End-to-end workflow
1. **Init** — `zond init --workspace --with-spec <path>` bootstraps a workspace + registers the API.
2. **Catalog** — `zond catalog <spec> --output apis/<name>/tests/` writes `.api-catalog.yaml`.
3. **Generate** — `zond generate <spec> --output apis/<name>/tests/` emits smoke + CRUD YAML.
4. **Sanity** — `zond run apis/<name>/tests/ --tag sanity --json` — must pass before broad generation.
5. **Coverage levels** — `zond coverage --spec <path> --tests apis/<name>/tests/` reports `untested / smoke / full` per endpoint.
6. **Smoke** — `zond run apis/<name>/tests/ --safe --json` runs only GET-only suites.
7. **CRUD** — drop `--safe` once setup-token captures and cleanup steps are wired.
8. **Gaps** — `zond probe-validation` + `zond probe-methods` for negative-input bug hunting.

For YAML format details (assertions, generators, captures, flow control,
`always: true` cleanup steps), read `ZOND.md` at the repo root or run
`zond run --help`. For auth patterns (`setup.yaml`, in-memory tokens,
multi-user) read `apis/<name>/tests/setup.yaml` examples produced by
`zond generate`.

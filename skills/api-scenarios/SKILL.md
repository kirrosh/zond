---
name: api-scenarios
description: |
  Create API scenario tests (user journeys). Use when asked to:
  write API scenario, create user flow test, replay UI flow via API,
  test user journey, scenario-based testing, create test data via API.
  Also activates on: user scenario, API workflow, scenario test.
allowed-tools: [Read, Write, Bash(zond *)]
---

# API Scenario Testing

CLI-only skill. zond is invoked directly via shell.

## Setup
Run `/zond:setup` first if zond is not installed.

## CLI commands
- `zond init --name <name> --spec <path>` — register API collection (once)
- `zond catalog <spec> --output <tests-dir>` — emit `.api-catalog.yaml`
- `zond run <path> --json` — execute a single scenario file or by tag
- `zond db diagnose <run-id> --json` — failure analysis
- `zond request <method> <url>` — ad-hoc HTTP for debugging

## Critical rules
- **NEVER use `zond generate` for scenarios** — write scenarios manually based on `.api-catalog.yaml`
- **NEVER read OpenAPI/Swagger spec files** — use `.api-catalog.yaml` or `zond describe`
- **NEVER invent endpoints** — only use what's in the catalog
- **Captures are file-scoped** — variables don't propagate across files unless `setup: true`
- Tag every scenario `[scenario, <name>]` so it runs via `--tag scenario` or `--tag <name>,setup`

## Quickstart
```bash
zond catalog <spec> --output <tests-dir>
# write scenario.yaml manually (see ZOND.md for YAML format)
zond run <tests-dir>/scenario.yaml --json
zond db diagnose <run-id> --json   # on failure
```

For full YAML structure, read the YAML format section of `ZOND.md` at the
repo root.

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

Thin orchestrator. Full content lives in MCP resources.

## Setup
Run `/zond:setup` first if zond is not installed.

## Resources to fetch
- `zond://workflow/scenarios` — full scenario authoring workflow
- `zond://rules/never` — MANDATORY NEVER
- `zond://reference/yaml` — assertions, generators, captures, flow control
- `zond://reference/auth-patterns` — `setup.yaml`, multi-user scenarios
- `zond://catalog/{api}` — endpoint reference for the target API

## MCP tools
- `zond_init` — register API collection (once per API)
- `zond_catalog` — generate `.api-catalog.yaml`
- `zond_run` — execute single scenario file or by tag
- `zond_diagnose` — failure analysis (or read `zond://run/{id}/diagnosis`)
- `zond_request` — ad-hoc HTTP for debugging

## Critical rules
- **NEVER use `zond generate` for scenarios** — write scenarios manually based on the catalog
- **NEVER read OpenAPI/Swagger spec files** — use `.api-catalog.yaml` or `zond_describe`
- **NEVER invent endpoints** — only use what's in the catalog
- **Captures are file-scoped** — variables don't propagate across files unless `setup: true`
- Tag every scenario `[scenario, <name>]` so it runs via `--tag scenario` or `--tag <name>,setup`

## Quickstart
```bash
zond catalog <spec> --output <tests-dir>
# write scenario.yaml manually (see zond://reference/yaml)
zond run <tests-dir>/scenario.yaml --json
zond db diagnose <run-id> --json   # on failure
```

For full patterns and YAML structure, fetch `zond://workflow/scenarios` and `zond://reference/yaml`.

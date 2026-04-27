# MANDATORY NEVER

Hard prohibitions. Every one of these traded a real failure mode for a rule.

## Spec & catalog
- **NEVER read OpenAPI/Swagger/JSON spec files** with Read or cat — use `.api-catalog.yaml`, `zond describe`, or the `zond_describe` MCP tool. Specs are huge; they will blow the context.
- **NEVER run `zond describe --compact` when `.api-catalog.yaml` exists** — read the catalog instead, it's faster and has more detail.
- **NEVER invent endpoints** — only use endpoints from `.api-catalog.yaml`, `zond describe`, or the `zond://catalog/{api}` resource.

## HTTP traffic
- **NEVER use curl/wget** for HTTP requests — use `zond request` (or the `zond_request` MCP tool) so traffic is logged consistently.
- **NEVER use `zond request` on auth endpoints to debug auth failures** — each manual call burns the rate-limit budget. Use `zond db diagnose` and existing run results instead.

## Generated tests
- **NEVER write test YAML files from scratch** for full coverage — use `zond generate` first, then edit specific files to fix failures. Hand-written suites for scenarios are fine; for spec-derived smoke/CRUD they are not.
- **NEVER use `zond generate` for scenarios** — scenarios are user journeys, write them manually based on the catalog.

## Auth & setup
- **NEVER hardcode auth tokens in `.env.yaml` for servers with in-memory storage** — tokens reset on restart; use `setup.yaml` with `setup: true` to capture a fresh token. Static tokens in `.env.yaml` are fine for persistent API keys or long-lived tokens.
- **NEVER put `logout` in a setup suite** — it invalidates the captured token for all other suites; keep logout in a dedicated non-setup auth test suite.
- **NEVER repeat login steps in multiple suites** — centralize auth in `setup.yaml`; repeated logins quickly exhaust rate limits.

## Tagging & runs
- **NEVER tag reset/system endpoints as `smoke`** — use `[system, reset]` or `[unsafe]`; `smoke` runs in `--safe` mode and will wipe server state.
- **NEVER run `--tag <group>` alone if there's a setup suite** — setup suites only run when their tag is included in the list; always append the setup suite's tag (e.g. `--tag crud,setup`).

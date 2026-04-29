---
name: zond-scenarios
description: |
  Author multi-step API scenario tests (user journeys) with zond. Use when asked to:
  write a scenario, model a user flow, replay a UI flow via API, chain requests with
  captures, set up test data via API, test a workflow end-to-end. Activates on:
  "user scenario", "API workflow", "multi-step test", "login then ...", "create then ...".
allowed-tools: [Read, Write, Bash(zond *), Bash(bunx zond *)]
---

# zond — API Scenario Tests

CLI-only skill. Scenarios are **hand-written** YAML chaining multiple requests
with captures (no `zond generate` for scenarios — `generate` only emits per-endpoint suites).

## Critical rules
- **NEVER** run `zond generate` to produce scenarios — write them manually from `.api-catalog.yaml`.
- **NEVER** read OpenAPI/Swagger specs directly — use `zond catalog` or `zond describe`.
- **NEVER** invent endpoints — only use entries present in `.api-catalog.yaml`.
- **Captures are file-scoped** — variables defined in one file do not leak into others
  unless the producing suite is marked `setup: true`.
- Tag every scenario `[scenario, <flow-name>]`. Run by `--tag scenario` or `--tag <flow>,setup`.
- Keep one user journey per file; chain steps within that file.

## Workflow
```bash
# 1. Make sure the catalog is current
zond catalog <spec> --output apis/<name>/tests

# 2. Read the catalog to pick endpoints (NOT the raw spec)
cat apis/<name>/tests/.api-catalog.yaml

# 3. Author the scenario YAML (see structure below)

# 4. Validate + run
zond validate apis/<name>/tests/scenarios/<flow>.yaml
zond run apis/<name>/tests/scenarios/<flow>.yaml --json

# 5. Diagnose failures
zond db diagnose <run-id> --json
```

## Scenario YAML — minimal structure
```yaml
name: user_signup_to_first_purchase
tags: [scenario, signup_purchase]
steps:
  - name: register
    request:
      method: POST
      url: "{{base_url}}/auth/register"
      body: { email: "{{generate.email}}", password: "{{generate.password}}" }
    expect: { status: 201 }
    capture:
      user_id: "$.id"
      auth_token: "$.token"

  - name: create_cart
    request:
      method: POST
      url: "{{base_url}}/carts"
      headers: { Authorization: "Bearer {{auth_token}}" }
    expect: { status: 201 }
    capture: { cart_id: "$.id" }

  - name: checkout
    request:
      method: POST
      url: "{{base_url}}/carts/{{cart_id}}/checkout"
      headers: { Authorization: "Bearer {{auth_token}}" }
    expect: { status: 200 }

  - name: cleanup
    always: true                       # runs even if earlier steps failed
    request:
      method: DELETE
      url: "{{base_url}}/users/{{user_id}}"
      headers: { Authorization: "Bearer {{auth_token}}" }
```

Key building blocks (full reference in `ZOND.md`):
- `capture: { var: "$.json.path" }` — JSONPath extraction into scenario-local vars.
- `expect.status` / `expect.json` / `expect.headers` — assertions.
- `{{generate.email}}`, `{{generate.uuid}}`, `{{generate.int(1,100)}}` — value generators.
- `always: true` on a step — guaranteed cleanup (runs on prior failure).
- `setup: true` at the suite level — captures propagate to other suites in the run.

## Sharing auth across scenarios
Put login in `apis/<name>/tests/setup.yaml` with `setup: true`; scenarios reference
`{{auth_token}}` directly. Run with `--tag <flow>,setup`.

## When to hand off
- Need broad endpoint coverage, not a flow → `zond-coverage`.
- Scenario fails and you don't know why → `zond-diagnose`.

For full YAML structure (assertions, flow control, generators, conditional steps),
see the YAML format section of `ZOND.md` at the repo root.

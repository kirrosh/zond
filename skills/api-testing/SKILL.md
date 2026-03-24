---
name: api-testing
description: |
  API testing with zond. Use when asked to: test API, cover endpoints,
  run smoke tests, analyze API coverage, diagnose test failures,
  set up API test infrastructure, generate CI for API tests.
  Also activates on: openapi.json, swagger, API spec, test coverage.
allowed-tools: [Read, Write, Bash(zond *), Bash(cat *), Bash(which zond)]
---

# Zond API Testing

## Setup check
!`which zond 2>/dev/null && echo "INSTALLED" || echo "NOT_INSTALLED"`

If NOT_INSTALLED, run: `npx -y @kirrosh/zond@latest` as prefix for all commands below.
Otherwise use `zond` directly.

## How it works

Zond is a CLI tool for API testing. You call it via bash, read JSON output,
and make decisions based on results.

### Core workflow

1. **Init** (once per API):
   ```bash
   zond init --name <name> --spec <path-to-openapi> [--base-url <url>]
   ```

2. **Explore** (understand what to test):
   ```bash
   zond describe <spec> --compact --json    # overview of all endpoints
   zond describe <spec> --path /endpoint --method GET --json  # one endpoint
   ```

3. **Write tests** — YOU write YAML files directly (see format below)

4. **Validate** before running:
   ```bash
   zond validate <tests-dir-or-file>
   ```

5. **Run**:
   ```bash
   zond run <path> --safe --json              # GET-only, safe for prod
   zond run <path> --dry-run --json           # preview without sending
   zond run <path> --env staging --json       # specific environment
   zond run <path> --tag smoke --json         # filter by tag
   ```

6. **Diagnose failures**:
   ```bash
   zond db diagnose <run-id> --json
   ```

7. **Track coverage**:
   ```bash
   zond coverage --spec <spec> --tests <dir> --json
   ```

8. **Compare runs** (regression):
   ```bash
   zond db compare <old-run-id> <new-run-id> --json
   ```

### YAML test format

```yaml
name: "Suite name"
tags: [smoke]
base_url: "{{base_url}}"
headers:
  Authorization: "Bearer {{auth_token}}"

tests:
  - name: "Test name"
    GET: /endpoint
    expect:
      status: 200
      body:
        id: { type: integer }
        name: { type: string }
```

#### Assertions
`equals`, `type`, `capture`, `contains`, `matches`, `gt`, `lt`, `exists`.
Nested: `category.name: { equals: "Dogs" }`.
Root body: `_body: { type: "array" }`.
Status accepts single int or array: `status: [200, 204]`.

#### Variable capture and chaining
```yaml
- name: "Create"
  POST: /users
  json: { name: "{{$randomName}}" }
  expect:
    status: 201
    body:
      id: { capture: user_id }

- name: "Get created"
  GET: /users/{{user_id}}
  expect:
    status: 200
```

#### Generators
`{{$randomInt}}`, `{{$uuid}}`, `{{$timestamp}}`, `{{$randomEmail}}`,
`{{$randomString}}`, `{{$randomName}}`

#### Environments
`.env.yaml` (default) or `.env.<name>.yaml` in tests dir or parent.

### Safety rules

- `--safe` → only GET requests execute, write ops skipped
- `--dry-run` → shows requests without sending
- Never run CRUD tests unless user confirmed staging/test environment
- Tags: `smoke` for GET-only, `crud` for write operations
- If endpoint returns 500, keep `status: 200` in expect — failing test = API bug

### Reading JSON output

All `--json` output follows:
```json
{"ok": true, "command": "...", "data": {...}, "warnings": [], "errors": []}
```

For `run --json`, data contains:
- `summary`: total/passed/failed/skipped counts
- `failures`: array of {step, expected, actual, response_body}
- `run_id`: for use with `db diagnose` and `db compare`

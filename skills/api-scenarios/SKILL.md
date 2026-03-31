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

Create and run scenario tests that replay user journeys via API calls.

## Setup — ALWAYS run first
Before anything else, run `/zond:setup` — it checks installation and updates automatically.

## NEVER do these — MANDATORY
- **NEVER read OpenAPI/Swagger/JSON spec files** with Read or cat — use `.api-catalog.yaml`
- **NEVER use `zond generate` for scenarios** — write YAML manually based on the catalog
- **NEVER hardcode auth tokens in `.env.yaml` for servers with in-memory storage** — use `setup.yaml` with `setup: true`
- **NEVER invent endpoints** — only use endpoints from `.api-catalog.yaml`
- **NEVER use curl/wget** for HTTP requests — use `zond request` for ad-hoc debugging

## Workflow

### Step 1: Init API (once per API)
```bash
zond init --name <name> --spec <path-to-openapi> [--base-url <url>]
```

### Step 2: Generate catalog (not full tests)
```bash
zond catalog <spec> --output <tests-dir>
```
This creates `.api-catalog.yaml` — a compact reference of all endpoints with parameters, request/response schemas, and auth info.

### Step 3: Read catalog
Read `<tests-dir>/.api-catalog.yaml` to understand available endpoints, their parameters, and response shapes. Use this to plan scenario steps.

### Step 4: Setup auth (if needed)
Create `setup.yaml` with `setup: true` to capture auth token:
```yaml
name: setup
setup: true
tags: [setup]
base_url: "{{base_url}}"
tests:
  - name: Login
    POST: /auth/login
    json:
      username: "{{admin_username}}"
      password: "{{admin_password}}"
    expect:
      status: 200
      body:
        token: { capture: auth_token }
```
Fill credentials in `.env.yaml`.

### Step 5: Write scenario
Each scenario is a separate YAML file with a unique tag:
```yaml
name: user-registration-flow
tags: [scenario, registration]
base_url: "{{base_url}}"
headers:
  Authorization: "Bearer {{auth_token}}"
tests:
  - name: Register new user
    POST: /auth/register
    json:
      email: "{{$randomEmail}}"
      password: "TestPass123!"
      name: "{{$randomName}}"
    expect:
      status: 201
      body:
        id: { capture: new_user_id }
        token: { capture: new_user_token }

  - name: Get own profile
    GET: /users/{{new_user_id}}
    headers:
      Authorization: "Bearer {{new_user_token}}"
    expect:
      status: 200
      body:
        id: { equals: "{{new_user_id}}" }
        email: { type: string }

  - name: Update profile
    PUT: /users/{{new_user_id}}
    headers:
      Authorization: "Bearer {{new_user_token}}"
    json:
      name: "Updated Name"
    expect:
      status: 200
      body:
        name: { equals: "Updated Name" }
```

### Step 6: Run scenario
```bash
# Run a single scenario file
zond run <tests-dir>/registration-flow.yaml --json

# Run all scenarios (with setup for auth)
zond run <tests-dir> --tag scenario,setup --json

# Run specific scenario by tag
zond run <tests-dir> --tag registration,setup --json
```

### Step 7: Diagnose failures
```bash
zond db diagnose <run-id> --json
zond db diagnose <run-id> --verbose --json
```
Check `recommended_action` for each failure:
- `fix_test_logic` → fix path, body, or assertions in scenario YAML
- `fix_auth_config` → fix credentials in `.env.yaml`
- `report_backend_bug` → server error, report to user

## Key rules for scenarios

### Captures chain steps together
Use `capture:` in assertions to save values, then `{{var}}` to use them in later steps:
```yaml
- name: Create order
  POST: /orders
  json: { product_id: 1, quantity: 2 }
  expect:
    status: 201
    body:
      id: { capture: order_id }

- name: Check order status
  GET: /orders/{{order_id}}
  expect:
    status: 200
    body:
      status: { equals: "pending" }
```

### Captures are file-scoped
Variables captured in one file do NOT propagate to other files. Exception: `setup: true` suites share captures with all regular suites.

### Use generators for unique test data
- `{{$randomEmail}}` — unique email
- `{{$randomName}}` — random name
- `{{$uuid}}` — UUID
- `{{$randomInt}}` — random integer
- `{{$timestamp}}` — Unix timestamp
- `{{$randomString}}` — random string

### Use `set:` to pin generated values
```yaml
- name: Prepare data
  set:
    test_email: "{{$randomEmail}}"
- name: Register
  POST: /auth/register
  json: { email: "{{test_email}}" }
  expect:
    status: 201
```

### Tagging convention
Every scenario should have `[scenario, <name>]` tags:
- `scenario` — groups all scenarios for `--tag scenario`
- `<name>` — unique tag for running individually: `--tag <name>,setup`

### Assertions
- `equals`, `not_equals` — exact match
- `type` — string, integer, number, boolean, array, object
- `contains`, `not_contains` — substring match
- `matches` — regex
- `exists` — field presence
- `gt`, `lt`, `gte`, `lte` — numeric comparison
- `length`, `length_gt`, `length_lt` — array/string length
- `capture` — save value for later steps
- Status: `status: 200` or `status: [200, 201]`
- Nested fields: `data.user.id: { type: integer }`

### Flow control
```yaml
# Skip step conditionally
skip_if: "{{item_id}} == 0"

# Retry until condition
retry_until:
  condition: "{{status}} == completed"
  max_attempts: 5
  delay_ms: 1000

# Iterate over array
for_each:
  var: id
  in: "{{item_ids}}"
```

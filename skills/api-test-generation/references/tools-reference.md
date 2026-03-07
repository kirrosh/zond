# zond MCP Tools Reference

Complete reference for all 12 MCP tools provided by the zond server.

## Tool Inventory

### Setup & Configuration

| Tool | Description |
|------|-------------|
| `set_work_dir` | Set project root for the session. **Call first** with npx MCP so `zond.db` and relative paths resolve correctly. |
| `setup_api` | Register a new API — creates directory structure, reads OpenAPI spec, sets up `.env.yaml` with `.gitignore`, creates a collection in the database. Warns if spec has relative server URL. Use `insecure: true` for self-signed HTTPS certs. |

### Test Generation

| Tool | Description |
|------|-------------|
| `generate_and_save` | **Recommended entry point.** Auto-chunks large APIs by tag (>30 endpoints). Returns a chunking plan or a focused generation guide. Supports `tag`, `methodFilter`, `testsDir` (coverage mode). |
| `generate_tests_guide` | Returns full API spec + step-by-step generation algorithm. Use when you need the raw guide without auto-chunking. Supports `tag` and `methodFilter`. |
| `generate_missing_tests` | Combines coverage analysis + generation guide for only uncovered endpoints. Use for incremental test generation. |

### Test Management

| Tool | Description |
|------|-------------|
| `save_test_suite` | Validate YAML content + save a single test file. Returns structured errors if validation fails. |
| `save_test_suites` | Batch save multiple YAML test files in one call. Each file is validated before writing. |

### Test Execution

| Tool | Description |
|------|-------------|
| `run_tests` | Execute tests from a YAML file or directory. Returns summary with failures. Key params: `safe` (GET-only), `dryRun` (no HTTP), `tag` (filter), `envName`, `envVars`. |

### Analysis & Diagnostics

| Tool | Description |
|------|-------------|
| `query_db` | Query the database with various actions (see below). |
| `coverage_analysis` | Compare OpenAPI spec vs existing tests. Shows covered/uncovered endpoints. `failThreshold` for CI gates. `runId` for enriched pass/fail/5xx breakdown. |
| `describe_endpoint` | Full details for one endpoint: params by type, request body schema, all response schemas + headers, security, deprecated flag. |
| `send_request` | Ad-hoc HTTP request with variable interpolation from environments. Use `jsonPath` to extract subset (e.g. `[0].code`), `maxResponseChars` to truncate large responses. |

### Infrastructure

| Tool | Description |
|------|-------------|
| `manage_server` | Start/stop/restart the Web UI server. Actions: `start`, `stop`, `restart`, `status`. |
| `ci_init` | Generate CI/CD workflow file (GitHub Actions or GitLab CI). Auto-detects platform from project structure. |

## query_db Actions

| Action | Required Params | Description |
|--------|----------------|-------------|
| `list_collections` | — | All registered APIs with run stats |
| `list_runs` | `limit` (optional) | Recent test runs |
| `get_run_results` | `runId` | Full detail for a run — all steps with status |
| `diagnose_failure` | `runId`, `verbose` (opt) | Only failed/errored steps with `response_body`, `failure_type`, and `envHint`. Stack traces truncated by default; use `verbose: true` for full output |
| `compare_runs` | `runId`, `runIdB` | Diff two runs — regressions, fixes, performance delta |

### diagnose_failure Details

Each failure includes:
- **failure_type**: `api_error` (HTTP 4xx/5xx), `assertion_failed` (response didn't match), `network_error` (connection/timeout)
- **envHint**: diagnostic hint for common issues (relative URL, unresolved `{{variable}}`, malformed URL)
- **error_message**: truncated by default (first line + 3 stack lines); use `verbose: true` for full trace
- **response_body**: actual response for debugging
- **summary**: aggregated counts of `api_errors`, `assertion_failures`, `network_errors`

## YAML Test Format

```yaml
name: Users API
description: "Smoke tests for user endpoints"
tags: [users, smoke]
base_url: "{{base_url}}"
headers:
  Authorization: "Bearer {{auth_token}}"

tests:
  - name: "List users"
    GET: /users
    expect:
      status: 200
      _body: { type: array, length_gt: 0 }

  - name: "Get user by ID"
    GET: /users/1
    expect:
      status: 200
      id: { type: integer }
      name: { type: string }
```

**Important**:
- Assertions go directly inside `expect:`, NOT nested under `body:`. Use `_body` for root-level body assertions.
- Use `json:` for JSON request bodies. `body:` is NOT a valid key.
- `_body` capture works for all response types including `text/plain` (stored as string).

### Assertions

| Assertion | Example | Description |
|-----------|---------|-------------|
| `equals` | `name: { equals: "John" }` | Exact value match |
| `type` | `id: { type: "integer" }` | Type check: string, integer, number, boolean, array, object |
| `capture` | `id: { capture: "user_id" }` | Store value for later use |
| `contains` | `name: { contains: "Jo" }` | Substring match |
| `matches` | `email: { matches: "^.+@.+$" }` | Regex match |
| `gt` / `lt` | `count: { gt: 0 }` | Greater/less than |
| `exists` | `field: { exists: true }` | Check field presence |

Nested fields: `category.name: { equals: "Dogs" }`
Root body: `_body: { type: "array" }`
Status: single integer (`200`) or array of allowed codes (`[200, 204]`)

### Generators

| Generator | Output |
|-----------|--------|
| `{{$randomInt}}` | Random integer |
| `{{$uuid}}` | UUID v4 |
| `{{$timestamp}}` | Unix timestamp |
| `{{$randomEmail}}` | Random email address |
| `{{$randomString}}` | Random alphanumeric string |
| `{{$randomName}}` | Random person name |

### Environment Variables

Environments are file-based. Place `.env.yaml` in the API base directory:

```yaml
base_url: https://api.example.com
auth_token: your-token
custom_var: value
```

For named environments, use `.env.<name>.yaml`:

```yaml
# .env.staging.yaml
base_url: https://staging.api.example.com
auth_token: staging-token
```

Search order: test file directory, then parent directory.

`setup_api` automatically creates `.gitignore` with `.env*.yaml` to prevent committing secrets.

### Runtime Environment Variables

Use `envVars` parameter on `run_tests` to inject variables at runtime (overrides file-based values):

```
run_tests(testPath: "tests/", envVars: { "base_url": "http://localhost:3000" })
```

## Safe Testing Phases

| Phase | What | Safety Level | Requires |
|-------|------|-------------|----------|
| Phase 0 | `setup_api` + `coverage_analysis` | Zero HTTP requests | Nothing |
| Phase 1 | GET-only smoke tests | Read-only | `safe: true`, `methodFilter: ["GET"]` |
| Phase 2 | CRUD tests | Write operations | User confirmation + staging env |
| Phase 3 | Regression + CI | Comparison + automation | Previous run data |

## Chunking Large APIs

APIs with >30 endpoints are automatically chunked by tag. The `generate_and_save` tool returns a plan:

```
Chunking plan:
- tag: "pets" (12 endpoints)
- tag: "users" (8 endpoints)
- tag: "orders" (15 endpoints)
```

Process each chunk separately:
```
generate_and_save(specPath: "spec.json", tag: "pets")
save_test_suites(files: [...])
generate_and_save(specPath: "spec.json", tag: "users")
save_test_suites(files: [...])
```

## Practical Tips

- **int64 IDs**: For APIs returning large auto-generated IDs (int64), prefer setting fixed IDs in request bodies rather than capturing auto-generated ones, as JSON number precision may cause mismatches.
- **Nested assertions**: Use dot-notation or nested YAML — both work identically.
- **Root body type**: Use `_body: { type: "array" }` to verify the response body type itself.
- **List endpoints**: Combine assertions in one key: `_body: { type: array, length_gt: 0 }` — do NOT repeat `_body` twice (YAML keys must be unique)
- **Create responses**: Always verify at least the key identifying fields (id, name) in the response body — don't just check status.
- **Error responses**: Assert that error bodies contain useful info (`message: { exists: true }`), not just status codes.
- **Bulk operations**: After bulk create (createWithArray, createWithList), add GET steps to verify resources were actually created.
- **204 No Content**: When an endpoint returns 204, omit `body:` assertions entirely — an empty response IS the correct behavior. Adding body assertions on 204 will always fail.
- **Cleanup pattern**: Always delete test data in the same suite. Use a create → read → delete lifecycle so tests are idempotent:
  ```yaml
  tests:
    - name: Create test resource
      POST: /users
      json: { name: "zond-test-{{$randomString}}" }
      capture:
        user_id: id
      expect:
        status: 201
    - name: Read created resource
      GET: /users/{{user_id}}
      expect:
        status: 200
    - name: Cleanup - delete test resource
      DELETE: /users/{{user_id}}
      expect:
        status: 204
  ```
- **Identifiable test data**: Prefix test data with `zond-test-` or use `{{$uuid}}` / `zond-test-{{$randomString}}` so you can identify and clean up leftover test data if needed.

## Common Mistakes to Avoid

1. **equals vs capture**: `capture` SAVES a value, `equals` COMPARES. To extract a token: `{ capture: "token" }` NOT `{ equals: "{{token}}" }`
2. **exists must be boolean**: `exists: true` NOT `exists: "true"`
3. **Status must be integer or array**: `status: 200` or `status: [200, 204]` NOT `status: "200"`
4. **One method per step**: Each test step has exactly ONE of GET/POST/PUT/PATCH/DELETE
5. **Don't hardcode base URL**: Use `{{base_url}}` — set it in environment or suite base_url
6. **Auth credentials**: Use environment variables `{{auth_username}}`, `{{auth_password}}` — NOT generators
7. **String query params**: Query parameter values must be strings: `limit: "10"` not `limit: 10`
8. **Hardcoded credentials**: NEVER put actual API keys/tokens in YAML — use `{{api_key}}` from env instead
9. **Body assertions on 204**: Don't add `body:` checks for DELETE or other endpoints that return 204 No Content — the body is empty by design.

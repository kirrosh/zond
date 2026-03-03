# Backlog

## High Priority

### One-shot test generation (`generate_and_save`)
New MCP tool that accepts spec path + optional endpoint filter and produces ready-to-save YAML test suites in one call. Eliminates the 3-step chain: `generate_tests_guide` → agent assembles YAML → `save_test_suite`.

### Conditional logic in suites (`skip_if` / `on_failure`)
Allow steps to be skipped based on captured variable values or previous step results:
```yaml
- name: "Delete item"
  DELETE: /items/{{item_id}}
  skip_if: "{{item_id}} == ''"
  on_failure: skip_remaining
  expect:
    status: [200, 204]
```
Requires mini-condition engine, changes to YAML schema, parser, and executor.

### Export to Postman Collection / pytest
Convert apitool YAML suites to Postman Collection v2.1 JSON or pytest files. Useful for teams that mix tooling.

---

## Medium Priority

### Split format guide from endpoint data
`generate_tests_guide` returns the full YAML format reference every call. Split into static format + dynamic endpoints, or cache format after first call.

### GitHub Action
`uses: kirrosh/apitool-action@v1` composite action (separate repo).

### Timestamp capture pattern
When a `timestamp` field is detected in a request body schema (common in OAuth, AWS Sig, Ably tokens), add a hint in the guide: "consider GET /time before this step to capture the server timestamp".

---

## Low Priority

### Summary after batch generation
After generating many suites, return a summary (created N files, total coverage %).

### Env file location in MCP output
`setup_api` should return the path to `.env.default.yaml` and a brief instruction for adding the API key in its response, so the agent knows exactly where to write credentials immediately after registration.

### Comment preservation
Parser preserves YAML comments when reading/writing (currently lost).

### `apitool docs` command
Generate markdown documentation from YAML tests: descriptions + examples.

### Multipart/form-data support
Runner support for file upload endpoints.

---

## Done (recently completed)

| Item | Notes |
|------|-------|
| `response_body` in `diagnose_failure` | `query_db(action:"diagnose_failure")` now includes parsed response body for each failed step (JSON object or truncated string, max 2000 chars) |
| Array statuses `status: [200, 204]` | `expect.status` now accepts `number \| number[]`. Assertion rule shows `"one of [200, 204]"`. Schema, types, assertions, and guide updated. |
| `--fail-on-coverage` flag | Fail CI if coverage below threshold: `apitool coverage --fail-on-coverage 80` |
| `--env-var` flag | Pass secrets from CI without env files: `apitool run --env-var "token=$API_TOKEN"` |
| `--dry-run` flag | Show requests without sending: `apitool run --dry-run` |
| `methodFilter` in generate guides | Filter by HTTP method: `generate_tests_guide(methodFilter: ["GET"])` |
| `save_test_suites` (plural) MCP tool | Batch save multiple YAML suites in one call |
| `apitool compare` command | Compare two runs, regression detection: `apitool compare <runA> <runB>` |
| `compare_runs` action in `query_db` | MCP equivalent of `apitool compare` |
| Per-suite env resolution | `.env.<name>.yaml` resolved from each suite's directory when running a directory |
| Env refactoring: file-only model | Removed DB `environments` table (schema V7), removed `manage_environment` MCP tool and `envs` CLI command. Single source of truth: `.env.yaml` / `.env.<name>.yaml` files. |

## Not Doing

| Item | Reason |
|------|--------|
| GraphQL / gRPC / WebSocket | REST + OpenAPI = 80% of market |
| Load testing | Use k6 instead |
| WebUI polish (themes, animations) | Not a selling point |
| Plugins / marketplace | Requires large team |
| Team features / RBAC | Different product category |
| Docker image | Single binary is simpler |

---
name: api-test-generation
description: This skill should be used when the user asks to "test an API", "cover endpoints with tests", "generate API tests", "create test suites from OpenAPI spec", "safely cover API", or mentions API testing workflow with apitool.
---

# API Test Generation Workflow

Generate comprehensive API tests from an OpenAPI spec using a safe, phased approach. Each phase increases risk — stop and confirm with the user before proceeding to write operations.

## Prerequisites

- The `apitool` MCP server must be connected (check with `/mcp`)
- An OpenAPI spec file (JSON or YAML) must be available

## Workflow

### Step 0 — Set Working Directory

**Always call first** when using the npx-based MCP server:

```
set_work_dir(workDir: "<absolute path to project root>")
```

This ensures `apitool.db` and all relative paths resolve correctly.

### Phase 0 — Register + Static Analysis (zero HTTP requests)

1. **Register the API:**
   ```
   setup_api(name: "<api-name>", specPath: "<path-to-spec>")
   ```
   This creates the directory structure, reads the spec, sets up `.env.yaml`, and registers a collection in the database.

2. **Analyze coverage baseline:**
   ```
   coverage_analysis(specPath: "<path-to-spec>", testsDir: "<tests-dir>")
   ```
   Shows total endpoints, covered/uncovered breakdown, and static warnings (deprecated endpoints, missing response schemas, required params without examples).

3. **Explore the API** (optional, for large specs):
   ```
   explore_api(specPath: "<path-to-spec>", includeSchemas: true)
   ```

### Phase 1 — Smoke Tests (GET-only, safe for production)

This phase only generates and runs read-only tests. Safe to run against any environment.

1. **Generate test guide:**
   ```
   generate_and_save(specPath: "<path-to-spec>", methodFilter: ["GET"])
   ```
   For large APIs (>30 endpoints), this auto-chunks by tags and returns a plan. Call again with `tag` parameter for each chunk.

2. **Save generated test suites:**
   ```
   save_test_suites(files: [...])
   ```
   Tag all GET-only suites with `tags: [smoke]`.

3. **Run tests in safe mode:**
   ```
   run_tests(testPath: "<tests-dir>", safe: true)
   ```
   The `safe: true` flag enforces GET-only — any write operations are automatically skipped.

4. **Diagnose any failures:**
   ```
   query_db(action: "diagnose_failure", runId: <id>)
   ```

**STOP HERE** unless the user explicitly confirms they have a staging/test environment.

### Phase 2 — CRUD Tests (requires explicit user confirmation)

Only proceed if the user has confirmed a safe (non-production) environment.

1. **Generate CRUD tests:**
   ```
   generate_and_save(specPath: "<path-to-spec>", testsDir: "<tests-dir>")
   ```
   This generates tests for uncovered endpoints (POST, PUT, DELETE). Tag with `tags: [crud]`.

2. **Dry-run first to preview:**
   ```
   run_tests(testPath: "<tests-dir>", tag: ["crud"], dryRun: true)
   ```
   Show the user what requests would be sent. **Wait for confirmation** before proceeding.

3. **Run CRUD tests:**
   ```
   run_tests(testPath: "<tests-dir>", tag: ["crud"], envName: "staging")
   ```

4. **Diagnose and fix failures** using the debug-test-failures workflow.

### Phase 3 — Regression Tracking + CI

1. **Compare runs:**
   ```
   query_db(action: "compare_runs", runId: <previous>, runIdB: <current>)
   ```

2. **Set up CI:**
   ```
   ci_init()
   ```

3. **Launch Web UI** for visual review:
   ```
   manage_server(action: "start")
   ```

## Safety Rules

| Mechanism | Purpose |
|-----------|---------|
| `safe: true` | Only GET requests execute; write ops are skipped |
| `dryRun: true` | Shows all requests without sending any |
| `methodFilter: ["GET"]` | Only generates GET test stubs |
| `tags: [smoke]` | Labels GET-only suites for filtering |
| `tags: [crud]` | Labels write operation suites |
| `tags: [destructive]` | Labels DELETE/dangerous operations |
| `tags: [auth]` | Labels authentication-related tests |

**Never run CRUD or destructive tests unless the user has confirmed a safe environment.**

## Tag Taxonomy

- **smoke** — GET-only, safe for production, quick health check
- **crud** — Create/Read/Update/Delete lifecycle tests
- **destructive** — DELETE operations, data-modifying tests
- **auth** — Authentication and authorization tests

## Working with Large APIs

For APIs with >30 endpoints, `generate_and_save` returns a chunking plan grouped by tags. Process each chunk:

```
generate_and_save(specPath: "spec.json", tag: "pets")
generate_and_save(specPath: "spec.json", tag: "users")
```

## Environment Setup

Create `.env.yaml` in the API base directory:

```yaml
base_url: https://staging.example.com/api
auth_token: your-token-here
```

For multiple environments, use `.env.<name>.yaml`:

```yaml
# .env.staging.yaml
base_url: https://staging.example.com/api
```

Then run with: `run_tests(testPath: "...", envName: "staging")`

## References

See [references/tools-reference.md](references/tools-reference.md) for detailed MCP tool documentation.

# APITOOL

**AI-native API testing tool** — OpenAPI spec → test generation → execution → diagnostics. One binary. Zero config.

- **MCP** — primary interface for AI agents (Claude Code, Cursor, Windsurf)
- **CLI** — for humans and CI/CD
- **WebUI** — dashboard for viewing results

---

## Safe Test Coverage Workflow

**When asked to "safely cover", "test without breaking anything", or "start with read-only tests" — follow this 4-phase approach:**

**Step 0 (required for npx MCP — single shared server):**
```
set_work_dir(workDir: "<absolute path to project root>")
```
Call this once at the start of the session so `apitool.db` and all relative paths resolve to your project directory.

**Phase 0 — Register + static analysis (zero requests)**
```
setup_api(...)
coverage_analysis(specPath, testsDir)   ← baseline, no HTTP
```

**Phase 1 — Smoke tests (GET-only, safe for production)**
```
generate_tests_guide(specPath, methodFilter: ["GET"])   ← GET endpoints only
save_test_suite(...)                                    ← tags: [smoke]
run_tests(testPath, safe: true)                         ← --safe enforces GET-only
```
Stop here if the user hasn't explicitly confirmed a staging/test environment.

**Phase 2 — CRUD tests (only with explicit user confirmation + staging env)**
```
run_tests(testPath, tag: ["crud"], dryRun: true)        ← show requests first, no sending
[show user what would be sent, ask confirmation]
run_tests(testPath, tag: ["crud"], envName: "staging")  ← only after confirmation
```

**Phase 3 — Regression tracking**
```
query_db(action: "compare_runs", runId: prev, runIdB: curr)
ci_init()
```

**Key safety rules:**
- `safe: true` on `run_tests` → only GET requests execute, write ops are skipped
- `dryRun: true` on `run_tests` → shows all requests without sending any
- `methodFilter: ["GET"]` on `generate_tests_guide` → only generates GET test stubs
- Always use `tags: [smoke]` for GET-only suites, `tags: [crud]` for write operations
- Never run CRUD tests unless user confirmed environment is safe (staging/test)

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `set_work_dir` | Set project root for the session (call **first** with npx MCP) |
| `setup_api` | Register API (dirs + spec + env + collection). Creates `.gitignore` with `.env*.yaml` |
| `generate_tests_guide` | Full API spec + generation algorithm. Use **before** writing tests |
| `generate_missing_tests` | Guide for only uncovered endpoints |
| `save_test_suite` | Validate YAML + save single file. Returns structured errors if validation fails |
| `save_test_suites` | Batch save multiple YAML suites in one call |
| `run_tests` | Execute tests, return summary with failures. Use `diagnose_failure` for per-step details |
| `query_db` | List collections/runs; `diagnose_failure` includes `response_body`; `compare_runs` for regression |
| `explore_api` | Browse OpenAPI spec (`includeSchemas=true` for schemas) |
| `describe_endpoint` | Full details for one endpoint: params, schemas, response headers, security |
| `coverage_analysis` | Compare spec vs existing tests. `failThreshold` for pass/fail gate |
| `validate_tests` | Check YAML syntax without running |
| `send_request` | Ad-hoc HTTP request with variable interpolation |
| `manage_server` | Start/stop WebUI server |
| `ci_init` | Generate CI/CD workflow (GitHub Actions / GitLab CI) |

### query_db actions

| Action | Description |
|--------|-------------|
| `list_collections` | All registered APIs with run stats |
| `list_runs` | Recent test runs (use `limit` to control count) |
| `get_run_results` | Full detail for a run (requires `runId`) |
| `diagnose_failure` | Only failed/errored steps with `response_body` (requires `runId`) |
| `compare_runs` | Diff two runs — new failures, fixed tests, performance delta (requires `runId` + `runIdB`) |

---

## CLI Commands

| Command | Description | Key flags |
|---------|-------------|-----------|
| `add-api <name>` | Register new API | `--spec`, `--dir`, `--env key=value` |
| `run <path>` | Run tests | `--env`, `--safe`, `--tag`, `--bail`, `--dry-run`, `--env-var KEY=VAL`, `--report json\|junit` |
| `compare <runA> <runB>` | Compare two test runs | |
| `coverage` | API test coverage | `--spec`, `--tests`, `--fail-on-coverage <N>` |
| `validate` | Validate YAML tests | |
| `runs [id]` | Run history | `--limit` |
| `collections` | List collections | |
| `serve` | Web dashboard | `--port`, `--watch` |
| `chat` | Interactive AI agent | `--provider`, `--model`, `--safe` |
| `mcp` | Start MCP server | `--db` |
| `ci init` | Generate CI/CD workflow | `--github`, `--gitlab`, `--dir`, `--force` |
| `init` | Scaffold new project | |
| `doctor` | Diagnostics | |
| `update` | Self-update | |

---

## YAML Test Format

```yaml
name: Users CRUD
description: "Full lifecycle test"
tags: [users, crud]
base_url: "{{base_url}}"
headers:
  Authorization: "Bearer {{auth_token}}"

tests:
  - name: "Create user"
    POST: /users
    json:
      name: "{{$randomName}}"
      email: "{{$randomEmail}}"
    expect:
      status: 201
      body:
        id: { capture: user_id, type: integer }

  - name: "Get user"
    GET: /users/{{user_id}}
    expect:
      status: 200
      body:
        id: { equals: "{{user_id}}" }

  - name: "Delete user"
    DELETE: /users/{{user_id}}
    expect:
      status: [200, 204]    # single value or array of allowed statuses
```

### Assertions

`equals`, `type`, `capture`, `contains`, `matches`, `gt`, `lt`, `exists` (boolean). Nested: `category.name: { equals: "Dogs" }`. Root body: `_body: { type: "array" }`.

`status` accepts a single integer (`200`) or an array of allowed codes (`[200, 204]`).

### Generators

`{{$randomInt}}`, `{{$uuid}}`, `{{$timestamp}}`, `{{$randomEmail}}`, `{{$randomString}}`, `{{$randomName}}`

### Environments

Environments are file-only. `loadEnvironment(envName?, searchDir)` looks for:
- `.env.yaml` (when no `envName` given)
- `.env.<envName>.yaml` (when `envName` given)

Search order: `searchDir`, then parent directory.

```yaml
# .env.staging.yaml
base_url: https://staging.example.com/api
token: staging-token
```

```bash
apitool run tests/ --env staging
```

`setup_api` creates a `.gitignore` with `.env*.yaml` in `baseDir` to prevent secrets from being committed.

---

## CI/CD

`apitool ci init` scaffolds GitHub Actions or GitLab CI workflow. Supports schedule, repository_dispatch, manual triggers. See [docs/ci.md](docs/ci.md).

---

## Principles

1. **One file** — download binary, run. No Docker, no npm.
2. **Tests as code** — YAML in git, code review, CI/CD.
3. **OpenAPI-first** — spec exists → tests generate.
4. **AI-native** — MCP for agents, CLI for humans, same engine.
5. **SQLite by default** — history works out of the box.

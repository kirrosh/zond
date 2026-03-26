# ZOND

**AI-native API testing tool** — OpenAPI spec → test generation → execution → diagnostics. One binary. Zero config.

- **CLI** — primary interface for Claude Code agents and CI/CD
- **MCP** — for Cursor, Windsurf, and other MCP-compatible editors
- **WebUI** — dashboard with health strip, endpoints/suites/runs tabs, step-level details

---

## Safe Test Coverage Workflow

CLI skill (`/test-api`) asks the user to choose coverage level (Safe / CRUD / Maximum), mapping to Phase 1 / Phase 1+2 / Phase 1+2+3.

**When asked to "safely cover", "test without breaking anything", or "start with read-only tests" — follow this 4-phase approach:**

**Phase 0 — Register + static analysis (zero requests)**

CLI (Claude Code agents):
```bash
zond init --spec <path> [--name <name>] [--base-url <url>]
zond coverage --spec <path> --tests <dir>   # baseline, no HTTP
```
MCP (Cursor, Windsurf):
```
setup_api(...)
coverage_analysis(specPath, testsDir)
```

**Phase 1 — Smoke tests (GET-only, safe for production)**

CLI:
```bash
zond generate <spec> --output <dir>   # generates test stubs; use --tag to filter
zond run <tests-dir> --safe           # --safe enforces GET-only
```
MCP:
```
run_tests(testPath, safe: true)       # agent writes YAML files directly, no save_test_suite
```
Stop here if the user hasn't explicitly confirmed a staging/test environment.

**Phase 2 — CRUD tests (only with explicit user confirmation + staging env)**

CLI:
```bash
zond run <tests-dir> --tag crud --dry-run   # show requests first, no sending
# [show user what would be sent, ask confirmation]
zond run <tests-dir> --tag crud --env staging
```
MCP:
```
run_tests(testPath, tag: ["crud"], dryRun: true)
run_tests(testPath, tag: ["crud"], envName: "staging")
```

**Phase 3 — Regression tracking**

CLI:
```bash
zond db compare <idA> <idB>
zond ci init
```
MCP:
```
query_db(action: "compare_runs", runId: prev, runIdB: curr)
ci_init()
```

**Key testing rules:**
- Never mask server errors: if endpoint returns 500, keep `status: 200` in expect — a failing test signals an API bug
- Fix test requests (auth, body, path), not expected responses
- Legitimate error expects: 404 missing, 400/422 bad input, 401 no auth

**Key safety rules:**
- `safe: true` on `run_tests` / `--safe` on `zond run` -> only GET requests execute, write ops are skipped
- `dryRun: true` on `run_tests` / `--dry-run` on `zond run` -> shows all requests without sending any
- `--safe` on `zond run` / `methodFilter: ["GET"]` (MCP) -> only GET endpoints execute
- Always use `tags: [smoke]` for GET-only suites, `tags: [crud]` for write operations
- Never run CRUD tests unless user confirmed environment is safe (staging/test)

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `setup_api` | Register API (dirs + spec + env + collection). Creates `.gitignore` with `.env*.yaml`. Warns on relative server URL. `insecure: true` for self-signed certs |
| `run_tests` | Execute tests, return summary with failures. Use `diagnose_failure` for per-step details |
| `query_db` | List collections/runs; `diagnose_failure` includes `response_body`; `compare_runs` for regression |
| `describe_endpoint` | Full details for one endpoint: params, schemas, response headers, security |
| `coverage_analysis` | Compare spec vs existing tests. `failThreshold` for pass/fail gate |
| `send_request` | Ad-hoc HTTP request with variable interpolation. `jsonPath` to extract subset, `maxResponseChars` to truncate |
| `manage_server` | Start/stop WebUI server (health strip, endpoints/suites/runs tabs) |
| `ci_init` | Generate CI/CD workflow (GitHub Actions / GitLab CI) |

> **Note for MCP users:** test file generation and saving is done by the agent writing YAML files directly (no `generate_and_save` or `save_test_suite` tools). Use `zond generate` CLI or write files manually, then run with `run_tests`.

### query_db actions

| Action | Description |
|--------|-------------|
| `list_collections` | All registered APIs with run stats |
| `list_runs` | Recent test runs (use `limit` to control count) |
| `get_run_results` | Full detail for a run (requires `runId`) |
| `diagnose_failure` | Only failed/errored steps with `response_body` (requires `runId`). Stack traces truncated by default; use `verbose: true` for full output |
| `compare_runs` | Diff two runs — new failures, fixed tests, performance delta (requires `runId` + `runIdB`) |

---

## CLI Commands

| Command | Description | Key flags |
|---------|-------------|-----------|
| `run <path>` | Run tests | `--env`, `--safe`, `--tag`, `--bail`, `--dry-run`, `--env-var KEY=VAL`, `--report json\|junit` |
| `validate <path>` | Validate YAML tests | |
| `coverage` | API test coverage | `--spec`, `--tests`, `--fail-on-coverage <N>` |
| `serve` | Web dashboard (health strip, endpoints/suites/runs tabs) | `--port`, `--watch` |
| `mcp` | Start MCP server | `--db`, `--dir` |
| `ci init` | Generate CI/CD workflow | `--github`, `--gitlab`, `--dir`, `--force` |

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

### Suite Variable Isolation

Each suite runs in its own variable scope. Captured variables do **not** propagate between suites. If multiple suites need `auth_token`, each must include its own login step or use a pre-set value from `.env.yaml`.

### ETag / Conditional Requests

If-Match and If-None-Match require escaped quotes around the ETag value:
```yaml
  - name: Update with ETag
    PUT: /items/{{item_id}}
    headers:
      If-Match: "\"{{etag}}\""
    json: { name: "updated" }
    expect:
      status: 200
```

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
zond run tests/ --env staging
```

`setup_api` creates a `.gitignore` with `.env*.yaml` in `baseDir` to prevent secrets from being committed.

---

## CI/CD

`zond ci init` scaffolds GitHub Actions or GitLab CI workflow. Supports schedule, repository_dispatch, manual triggers. See [docs/ci.md](docs/ci.md).

---

## Principles

1. **One file** — download binary, run. No Docker, no npm.
2. **Tests as code** — YAML in git, code review, CI/CD.
3. **OpenAPI-first** — spec exists → tests generate.
4. **AI-native** — MCP for agents, CLI for humans, same engine.
5. **SQLite by default** — history works out of the box.

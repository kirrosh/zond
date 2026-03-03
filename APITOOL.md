# APITOOL

**AI-native API testing tool** — OpenAPI spec → test generation → execution → diagnostics. One binary. Zero config.

- **MCP** — primary interface for AI agents (Claude Code, Cursor, Windsurf)
- **CLI** — for humans and CI/CD
- **WebUI** — dashboard for viewing results

---

## Quick Start

```bash
apitool update                    # install / update
apitool add-api myapi --spec openapi.json   # register API
apitool ai-generate --api myapi --prompt "test all CRUD endpoints"
apitool run --api myapi --env staging
apitool serve --port 4000         # web dashboard
```

### MCP Setup

```json
{ "mcpServers": { "apitool": { "command": "apitool", "args": ["mcp"] } } }
```

Then ask your AI agent: *"Test the API from openapi.json"*

---

## Architecture

```
src/
├── core/
│   ├── parser/       YAML → TestSuite (schema, variables, generators)
│   ├── runner/       HTTP execution, captures, assertions
│   ├── generator/    OpenAPI reader, coverage scanner, AI generation
│   ├── reporter/     Console, JSON, JUnit XML
│   └── agent/        AI Chat (AI SDK v6, tool calling)
├── db/               SQLite (runs, collections, environments)
├── mcp/              MCP Server (15 tools)
├── web/              Hono + HTMX dashboard
└── cli/              16 CLI commands
```

### Stack

Bun runtime, TypeScript, SQLite (`bun:sqlite`), Hono + HTMX, `bun build --compile` → single binary.

---

## Modules

### Parser
Reads YAML test files → `TestSuite[]`. Schema validation (Zod), variable interpolation (`{{base_url}}`), built-in generators (`{{$randomEmail}}`, `{{$uuid}}`, etc.), nested body assertion flattening.

### Runner
Executes test steps sequentially within a suite. Native `fetch`, captures (`{ capture: "token" }`), assertions (equals, type, contains, matches, gt/lt, exists), nested body paths (`category.name`), root body checks (`_body: { type: "array" }`).

### Generator
Reads OpenAPI specs (`@readme/openapi-parser`), compresses schemas for LLM context, scans test coverage, AI-based test generation (Ollama/OpenAI/Anthropic).

### Reporter
Console (colored, tags display), JSON, JUnit XML (CI-compatible).

### Agent
Interactive AI chat (`apitool chat`). AI SDK v6, tool calling, multi-provider (Ollama, OpenAI, Anthropic). Safe mode (GET-only).

### DB
SQLite auto-created. Tables: `collections`, `runs`, `results`, `environments`, `ai_generations`. Schema version 5.

### WebUI
Single-page dashboard: API selector → env selector → Run Tests → results + coverage + history. JUnit/JSON export. Hono + HTMX.

### MCP Server
15 tools for AI agent integration. Primary test generation flow:

```
generate_tests_guide → [agent writes YAML] → save_test_suite → run_tests → diagnose_failure → ci_init
```

### Safe Test Coverage Workflow

**When the user asks to "safely cover", "test without breaking anything", or "start with read-only tests" — follow this 4-phase approach:**

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

### CI/CD
`apitool ci init` scaffolds GitHub Actions or GitLab CI workflow. Supports schedule, repository_dispatch, manual triggers. See [docs/ci.md](docs/ci.md).

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `generate_tests_guide` | Full API spec + generation algorithm. Use **before** writing tests |
| `generate_missing_tests` | Guide for only uncovered endpoints |
| `save_test_suite` | Validate YAML + save file. Returns coverage hint |
| `run_tests` | Execute tests, return summary with failures |
| `query_db` | List collections, runs, results, diagnose failures |
| `explore_api` | Browse OpenAPI spec (`includeSchemas=true` for schemas) |
| `coverage_analysis` | Compare spec vs existing tests |
| `validate_tests` | Check YAML syntax without running |
| `send_request` | Ad-hoc HTTP request with variable interpolation |
| `setup_api` | Register API (dirs + spec + env + collection) |
| `manage_environment` | CRUD for environments |
| `manage_server` | Start/stop WebUI server |
| `ci_init` | Generate CI/CD workflow (GitHub Actions / GitLab CI) |

## CLI Commands

| Command | Description | Key flags |
|---------|-------------|-----------|
| `add-api <name>` | Register new API | `--spec`, `--dir`, `--env key=value` |
| `run <path>` | Run tests | `--api`, `--env`, `--report`, `--safe`, `--tag`, `--bail` |
| `ai-generate` | AI test generation | `--api`, `--from`, `--prompt`, `--provider`, `--model` |
| `validate` | Validate YAML tests | |
| `envs` | Environment management | `list\|get\|set\|delete\|import\|export`, `--api` |
| `runs [id]` | Run history | `--limit` |
| `coverage` | API test coverage | `--api`, `--spec`, `--tests` |
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
      status: 204
```

### Assertions

`equals`, `type`, `capture`, `contains`, `matches`, `gt`, `lt`, `exists` (boolean). Nested: `category.name: { equals: "Dogs" }`. Root body: `_body: { type: "array" }`.

### Generators

`{{$randomInt}}`, `{{$uuid}}`, `{{$timestamp}}`, `{{$randomEmail}}`, `{{$randomString}}`, `{{$randomName}}`

### Environments

```yaml
# .env.staging.yaml
base_url: https://staging.example.com/api
token: staging-token
```

`apitool run tests/ --env staging`

---

## Build

```bash
bun run build    # → apitool binary (standalone)
bun test         # run test suite
```

## Principles

1. **One file** — download binary, run. No Docker, no npm.
2. **Tests as code** — YAML in git, code review, CI/CD.
3. **OpenAPI-first** — spec exists → tests generate.
4. **AI-native** — MCP for agents, CLI for humans, same engine.
5. **SQLite by default** — history works out of the box.

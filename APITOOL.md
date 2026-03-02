# APITOOL

**AI-native API testing tool** — OpenAPI spec → intelligent test generation → execution → diagnostics. One binary. Zero config.

Primary interface: **MCP** (for AI agents like Claude Code, Cursor, Windsurf)
Secondary interface: **CLI** (for humans and CI/CD)
Utility: **WebUI** (viewing results)

---

## Quick Start

```bash
# Install — single binary, no dependencies
apitool update        # or download from GitHub Releases

# Register your API
apitool add-api myapi --spec openapi.json

# Generate tests (AI or manual)
apitool ai-generate --api myapi --prompt "test all CRUD endpoints"

# Run tests
apitool run --api myapi --env staging

# Web dashboard
apitool serve --port 4000
```

### MCP Setup (Claude Code / Cursor)

```json
{
  "mcpServers": {
    "apitool": {
      "command": "apitool",
      "args": ["mcp"]
    }
  }
}
```

Then ask your AI agent: *"Test the API from openapi.json"* — it will generate, save, run, and debug tests autonomously.

---

## Architecture

```
apitool/
├── src/
│   ├── core/
│   │   ├── parser/           # YAML → TestSuite (schema validation, variables, generators)
│   │   ├── runner/           # HTTP execution, captures, assertions
│   │   ├── generator/        # OpenAPI reader, schema compression, AI generation
│   │   │   ├── schema-utils.ts    # compressSchema(), formatParam() — shared utilities
│   │   │   ├── openapi-reader.ts  # readOpenApiSpec(), extractEndpoints()
│   │   │   ├── coverage-scanner.ts
│   │   │   └── ai/               # LLM-based test generation pipeline
│   │   ├── reporter/         # Console, JSON, JUnit XML output
│   │   └── agent/            # AI Chat (AI SDK v6, tool calling)
│   ├── db/                   # SQLite storage (runs, collections, environments)
│   ├── mcp/                  # MCP Server — AI agent integration
│   │   ├── server.ts
│   │   └── tools/            # 13 MCP tools
│   ├── web/                  # Hono + HTMX dashboard
│   └── cli/                  # 15 CLI commands
```

---

## Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun |
| Language | TypeScript (strict) |
| HTTP client | `fetch` (Bun native) |
| DB | SQLite (`bun:sqlite`) |
| Web server | Hono + `@hono/zod-openapi` |
| Frontend | HTMX + minimal CSS |
| OpenAPI parser | `@readme/openapi-parser` |
| Test format | YAML |
| Build | `bun build --compile` → single binary |

---

## MCP Tools

The primary way AI agents interact with apitool. 13 tools available:

| Tool | Description | When to use |
|------|-------------|-------------|
| `generate_tests_guide` | Full API spec with schemas + step-by-step generation algorithm | **Before** generating tests — gives everything needed |
| `save_test_suite` | Validate and save YAML test file | **After** generating test content |
| `run_tests` | Execute tests, return summary with failures | **After** saving test suites |
| `diagnose_failure` | Full request/response details for failed tests | **After** run_tests reports failures |
| `explore_api` | Browse OpenAPI spec (endpoints, schemas, security) | Inspect specific endpoints (`includeSchemas=true` for full schemas) |
| `coverage_analysis` | Compare spec vs existing tests | Find untested endpoints for incremental generation |
| `validate_tests` | Check YAML syntax without running | Quick validation |
| `send_request` | Ad-hoc HTTP request with variable interpolation | Manual API exploration |
| `manage_environment` | CRUD for environments (list/get/set/delete) | Configure base_url, tokens, credentials |
| `list_collections` | List registered APIs with stats | Overview of registered APIs |
| `list_runs` | Recent test run history | Review past results |
| `get_run_results` | Detailed results for a specific run | Deep dive into a run |

### MCP-First Test Generation Flow

```
1. generate_tests_guide(specPath)     → Full spec + algorithm
2. [Agent generates YAML content]     → Using the guide
3. save_test_suite(filePath, content) → Validates + saves
4. run_tests(testPath)                → Execute + summary
5. diagnose_failure(runId)            → If failures, analyze
6. save_test_suite(..., overwrite)    → Fix + re-save
```

---

## CLI Commands

| Command | Description | Key flags |
|---------|-------------|-----------|
| `add-api <name>` | Register new API (creates collection, dirs, .env.yaml) | `--spec`, `--dir`, `--env key=value` |
| `run <path>` | Run tests | `--api`, `--env`, `--report json\|junit\|console`, `--safe` |
| `ai-generate` | AI test generation from OpenAPI | `--api`, `--from`, `--prompt`, `--provider`, `--model` |
| `request <METHOD> <URL>` | Ad-hoc HTTP request | `--header`, `--body`, `--env` |
| `envs [list\|get\|set\|delete]` | Environment management | `--api` |
| `runs [id]` | Run history | `--limit` |
| `coverage` | API test coverage analysis | `--api`, `--spec`, `--tests` |
| `collections` | List collections | |
| `serve` | Start WebUI | `--port`, `--watch` |
| `validate` | Validate YAML tests | |
| `chat` | Interactive AI agent | `--provider`, `--model`, `--safe` |
| `mcp` | Start MCP server | `--db` |
| `doctor` | Diagnostics | |
| `init` | Scaffold new project | |
| `update` | Self-update | |

---

## YAML Test Format

### Minimal

```yaml
name: Health Check
tests:
  - name: "API is alive"
    GET: /health
    expect:
      status: 200
```

### Full CRUD Chain

```yaml
name: Users CRUD
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
        name: { type: string }

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

  - name: "Verify deleted"
    GET: /users/{{user_id}}
    expect:
      status: 404
```

### Assertions

| Rule | Example | Description |
|------|---------|-------------|
| `capture` | `{ capture: "token" }` | Save value to variable |
| `equals` | `{ equals: 42 }` | Exact match |
| `type` | `{ type: "string" }` | Type check (string/number/integer/boolean/array/object) |
| `contains` | `{ contains: "@" }` | Substring match |
| `matches` | `{ matches: "^[A-Z]+" }` | Regex match |
| `gt` / `lt` | `{ gt: 0, lt: 100 }` | Numeric comparison |
| `exists` | `{ exists: true }` | Field presence (must be boolean) |

### Built-in Generators

`{{$randomInt}}`, `{{$uuid}}`, `{{$timestamp}}`, `{{$randomEmail}}`, `{{$randomString}}`, `{{$randomName}}`

### Environments

```yaml
# .env.yaml (default)
base_url: http://localhost:3000/api

# .env.staging.yaml
base_url: https://staging.example.com/api
token: staging-token
```

Usage: `apitool run tests/ --env staging`

---

## Storage

SQLite (`apitool.db`) — created automatically. Stores runs, results, collections, environments, AI generation history.

Current schema version: **5**. Tables: `collections`, `runs`, `results`, `environments`, `ai_generations`.

---

## Milestone History

| Milestone | Status | Summary |
|-----------|--------|---------|
| M1-M9 | Done | Core engine: parser, runner, generator, reporter, storage, WebUI, CLI, binary, collections |
| M10 | Done | AI test generation (Ollama/OpenAI/Anthropic) |
| M11-M14 | Done | Suite details, public release, environments, self-documented API |
| M15-M16 | Done | MCP server (11 tools), generate wizard |
| M19-M21 | Done | Unified capabilities, doctor/import/export, collection architecture |
| **M22** | **Done** | **MCP-first smart test generation** — `generate_tests_guide`, `save_test_suite`, enhanced `explore_api` with schemas |

See [docs/BACKLOG-AI-NATIVE.md](docs/BACKLOG-AI-NATIVE.md) for future milestones (M23+).
See [docs/archive/](docs/archive/) for historical documentation snapshots.

---

## Build

```bash
bun run build    # → apitool.exe (standalone, Bun not needed)
bun test         # run test suite
```

## Principles

1. **One file** — download binary, run, done. No Docker, no npm.
2. **Tests as code** — YAML in git, code review, CI/CD.
3. **OpenAPI-first** — spec exists → tests generate.
4. **AI-native** — MCP for agents, CLI for humans, same engine.
5. **SQLite by default** — history works out of the box.

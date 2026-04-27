# ZOND

**AI-native API testing tool** — OpenAPI spec → test generation → execution → diagnostics. One binary. Zero config.

- **CLI** — primary interface for Claude Code agents and CI/CD
- **WebUI** — dashboard with health strip, endpoints/suites/runs tabs, step-level details

---

## Safe Test Coverage Workflow

CLI skill (`/test-api`) asks the user to choose coverage level (Safe / CRUD / Maximum), mapping to Phase 1 / Phase 1+2 / Phase 1+2+3.

**When asked to "safely cover", "test without breaking anything", or "start with read-only tests" — follow this 4-phase approach:**

**Phase 0 — Register + static analysis (zero requests)**

```bash
zond init --spec <path> [--name <name>] [--base-url <url>]
zond coverage --spec <path> --tests <dir>   # baseline, no HTTP
```

**Phase 1 — Smoke tests (GET-only, safe for production)**

```bash
zond generate <spec> --output <dir>   # generates test stubs; use --tag to filter
zond run <tests-dir> --safe           # --safe enforces GET-only
```
Stop here if the user hasn't explicitly confirmed a staging/test environment.

**Phase 2 — CRUD tests (only with explicit user confirmation + staging env)**

```bash
zond run <tests-dir> --tag crud --dry-run   # show requests first, no sending
# [show user what would be sent, ask confirmation]
zond run <tests-dir> --tag crud --env staging
```

**Phase 3 — Regression tracking**

```bash
zond db compare <idA> <idB>
zond ci init
```

**Key testing rules:**
- Never mask server errors: if endpoint returns 500, keep `status: 200` in expect — a failing test signals an API bug
- Fix test requests (auth, body, path), not expected responses
- Legitimate error expects: 404 missing, 400/422 bad input, 401 no auth

**Key safety rules:**
- `--safe` on `zond run` → only GET requests execute, write ops are skipped
- `--dry-run` on `zond run` → shows all requests without sending any
- Always use `tags: [smoke]` for GET-only suites, `tags: [crud]` for write operations
- Never run CRUD tests unless user confirmed environment is safe (staging/test)

---

## CLI Commands

| Command | Description | Key flags |
|---------|-------------|-----------|
| `run <path>` | Run tests | `--env`, `--safe`, `--tag`, `--bail`, `--dry-run`, `--env-var KEY=VAL`, `--report json\|junit` |
| `validate <path>` | Validate YAML tests | |
| `coverage` | API test coverage | `--spec`, `--tests`, `--fail-on-coverage <N>` |
| `serve` | Web dashboard (health strip, endpoints/suites/runs tabs) | `--port`, `--watch`, `--kill-existing` |
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

`zond init` creates a `.gitignore` with `.env*.yaml` in the API directory to prevent secrets from being committed.

---

## Bootstrapping a workspace

In a fresh directory, run `zond init` (no flags) to scaffold a zond workspace:

```bash
mkdir my-api-tests && cd my-api-tests
zond init                                    # creates zond.config.yml, apis/, AGENTS.md
                                             # also configures ~/.claude/mcp.json + ~/.cursor/mcp.json
```

Three integration modes are available via `--integration`:

| Mode  | Effect |
|---|---|
| `mcp` *(default)* | Writes a short `AGENTS.md` nudge pointing agents to MCP resources (`zond://workflow/test-api`, `zond://rules/never`) and configures Claude Code + Cursor MCP servers. |
| `cli` | Writes a self-contained `AGENTS.md` with the full workflow inline — for clients without MCP support. |
| `skip` | Creates only `zond.config.yml` + `apis/`. No agent files, no MCP install. |

Combo: `zond init --with-spec <path> --name <api>` bootstraps the workspace **and** registers the first API in one shot.

`AGENTS.md` is written between `<!-- zond:start -->` / `<!-- zond:end -->` markers, so an existing `AGENTS.md` is preserved and re-running `zond init` is idempotent (the block is replaced, surrounding content untouched).

The legacy `zond init --spec <path> --name <api>` keeps registering a single API without bootstrapping — backwards compatible.

---

## Workspace

zond resolves the workspace root via walk-up from the current directory. The first ancestor containing any of these markers is treated as the root:

1. `zond.config.yml`
2. `.zond/` directory
3. `zond.db`
4. `apis/` directory

The walk stops at `$HOME` to avoid accidentally adopting `~/apis` or `~/zond.db` when zond is invoked from an unrelated directory. If no marker is found, zond falls back to the current directory and prints a one-time warning to stderr — run `zond init` (or create `zond.config.yml`) to anchor the workspace explicitly.

The workspace root is used as the default location for `zond.db`, the `apis/<name>/` directory created by `zond init`, and the `.zond-current` file written by `zond use`. Explicit `--db` and `--dir` flags always win over walk-up.

### `zond serve` port handling

By default, `zond serve` is non-destructive: if the requested port (`--port` or 8080) is busy, it scans the next 10 ports and binds the first free one, printing the chosen port to stderr. If the entire 11-port range is busy, it exits 1 with instructions.

Pass `--kill-existing` to restore the legacy behaviour of terminating whichever process holds the requested port. Use with care — it will kill your dev backend if it happens to listen there.

---

## CI/CD

`zond ci init` scaffolds GitHub Actions or GitLab CI workflow. Supports schedule, repository_dispatch, manual triggers. See [docs/ci.md](docs/ci.md).

---

## Principles

1. **One file** — download binary, run. No Docker, no npm.
2. **Tests as code** — YAML in git, code review, CI/CD.
3. **OpenAPI-first** — spec exists → tests generate.
4. **AI-native** — skills for Claude Code agents, CLI for humans, same engine.
5. **SQLite by default** — history works out of the box.

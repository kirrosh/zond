---
name: api-testing
description: |
  API testing with zond. Use when asked to: test API, cover endpoints,
  run smoke tests, analyze API coverage, diagnose test failures,
  set up API test infrastructure, generate CI for API tests.
  Also activates on: openapi.json, swagger, API spec, test coverage.
allowed-tools: [Read, Write, Bash(zond *), Bash(which zond)]
---

# Zond API Testing

## Setup check
!`which zond 2>/dev/null && echo "INSTALLED" || echo "NOT_INSTALLED"`

If NOT_INSTALLED, run: `npx -y @kirrosh/zond@latest` as prefix for all commands below.
Otherwise use `zond` directly.

## NEVER do these — MANDATORY
- **NEVER read OpenAPI/Swagger/JSON spec files** with Read or cat — use `zond describe`
- **NEVER use curl/wget** for HTTP requests — use `zond request`
- **NEVER write test YAML files from scratch** — use `zond generate` first, then edit specific files to fix failures
- **NEVER invent endpoints** — only use endpoints from `zond describe` output

## Workflow

### Step 1: Init (once per API)
```bash
zond init --name <name> --spec <path-to-openapi> [--base-url <url>]
```

### Step 2: Explore
```bash
zond describe <spec> --compact --json
```

### Step 3: Generate tests — ALWAYS use CLI
```bash
zond generate <spec> --output <tests-dir> --json
```
This single command creates:
- Smoke tests (GET endpoints, grouped by tag)
- CRUD chains (POST → GET → PUT → DELETE with variable capture)
- Auth tests (login/register endpoints)
- `.env.yaml` with `base_url` from spec

**Do NOT write YAML files manually.** The generator handles assertions, captures, request bodies, and tag grouping automatically.

### Step 4: Validate and run smoke tests immediately
```bash
zond validate <tests-dir>
zond run <tests-dir> --safe --json
```
Always run smoke (GET-only) tests right after generation — they are safe and reveal spec/API mismatches early.

### Step 5: Diagnose and fix failures
If tests fail, use `run_id` from the run output:
```bash
zond db diagnose <run-id> --json
```
Read the diagnosis, then fix **specific** YAML files with Edit/Write.
Common fixes: wrong expected status, missing auth headers, incorrect body schema.

Use ad-hoc requests to debug endpoints:
```bash
zond request GET https://api.example.com/endpoint --json
zond request POST https://api.example.com/endpoint --body '{"key":"value"}' --json
```

After fixing, re-run and repeat until all smoke tests pass.

### Step 6: Run full suite (when user confirms test environment)
```bash
zond run <tests-dir> --json               # all tests including CRUD
zond run <tests-dir> --tag crud --json    # CRUD only
zond run <tests-dir> --env staging --json # specific environment
```
Diagnose and fix failures the same way as step 5.

### Step 7: Track coverage and fill gaps
```bash
zond coverage --spec <spec> --tests <tests-dir> --json
```
If gaps remain:
```bash
zond generate <spec> --output <tests-dir> --uncovered-only --json
```
For edge cases the generator can't create (negative tests, business logic), write individual YAML files — see format reference below.

## Safety rules
- `--safe` → only GET requests execute
- `--dry-run` → shows requests without sending
- Never run CRUD tests unless user confirmed staging/test environment
- If endpoint returns 500, keep `status: 200` in expect — failing test = API bug

## JSON output format
All `--json` output follows:
```json
{"ok": true, "command": "...", "data": {...}, "warnings": [], "errors": []}
```

## YAML reference (for editing/fixing tests)
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
```
Assertions: `equals`, `type`, `capture`, `contains`, `matches`, `gt`, `lt`, `exists`.
Nested: `category.name: { equals: "Dogs" }`. Root body: `_body: { type: "array" }`.
Status: `status: 200` or `status: [200, 204]`.
Capture: `id: { capture: user_id }` then use `{{user_id}}` in later steps. **Captures are suite-scoped** — they do NOT propagate between suites. Each suite needing auth must login itself or use `.env.yaml`.
ETag: If-Match requires escaped quotes — `If-Match: "\"{{etag}}\""`. Same for If-None-Match.
Generators: `{{$randomInt}}`, `{{$uuid}}`, `{{$timestamp}}`, `{{$randomEmail}}`, `{{$randomString}}`, `{{$randomName}}`.
Env: `.env.yaml` (default) or `.env.<name>.yaml` in tests dir or parent.

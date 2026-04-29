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

For each tag the generator emits up to **three** smoke suites:

- `<tag>-smoke` — paramless GETs (list/health endpoints), runs unconditionally.
- `<tag>-smoke-negative` — single-resource GETs (`/users/{id}` shape) called with a guaranteed-bad ID. Expects `[400, 404, 422]`. Verifies routing, auth, and base URL are wired up.
- `<tag>-smoke-positive` — same endpoints called with `{{param}}` from `.env.yaml`. Tagged `[smoke, positive, needs-id]`. Each step has `skip_if: "{{param}} =="` — auto-skips while the env var is empty (default after `zond generate`), runs once you fill it in.

Filtering recipes:

```bash
zond run apis/x/tests --tag smoke                     # all three (positive auto-skips until IDs set)
zond run apis/x/tests --tag smoke --exclude-tag needs-id  # only suites that work without real IDs
zond run apis/x/tests --tag positive                  # opt-in: requires real IDs in env
```

**Phase 2 — CRUD tests (only with explicit user confirmation + staging env)**

```bash
zond run <tests-dir> --tag crud --dry-run   # show requests first, no sending
# [show user what would be sent, ask confirmation]
zond run <tests-dir> --tag crud --env staging
```

CRUD suites are auto-classified by cleanup behavior:

- `[crud, ephemeral]` — suite includes a final `DELETE` step → API state unchanged after the run. Safe default for CI.
- `[crud, persistent-write]` — suite creates resources without deleting them → leaves residual data. Opt-in only.

Filtering recipes:

```bash
zond run <tests-dir> --tag crud --exclude-tag persistent-write   # CI default — only ephemeral
zond run <tests-dir> --tag crud                                  # everything (incl. persistent writes)
zond run <tests-dir> --tag persistent-write                      # only suites that leave state
```

`zond ci init` writes templates with `--exclude-tag persistent-write` baked into the CRUD job by default.

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
| `run <path>` | Run tests | `--env`, `--safe`, `--tag`, `--bail`, `--dry-run`, `--env-var KEY=VAL`, `--rate-limit <N>`, `--report json\|junit`, `--report-out <file>` |
| `validate <path>` | Validate YAML tests | |
| `coverage` | API test coverage | `--spec`, `--tests`, `--fail-on-coverage <N>` |
| `serve` | Web dashboard (health strip, endpoints/suites/runs tabs) | `--port`, `--watch`, `--kill-existing` |
| `ci init` | Generate CI/CD workflow | `--github`, `--gitlab`, `--dir`, `--force` |
| `probe-validation <spec>` | Generate negative-input probe suites (catch 5xx-on-bad-input) | `--output <dir>`, `--tag`, `--max-per-endpoint <N>`, `--no-cleanup` |
| `probe-methods <spec>` | Generate negative-method probe suites (catch 5xx/2xx on undeclared methods) | `--output <dir>`, `--tag` |

### `probe-validation` — bug-hunting negative-input probes

A correctly-implemented API returns **4xx** for any malformed client input —
never **5xx**. `probe-validation` generates a deterministic battery of
negative-input probes from your OpenAPI spec; any 5xx response from the API
under test is a bug candidate.

```bash
zond probe-validation openapi.json --output bugs/probes/
zond run bugs/probes/                     # any failure with 5xx response → bug
zond db diagnose <run-id>                 # group failures by root cause
```

Per endpoint the generator emits probes from these classes (capped by
`--max-per-endpoint`, default 50):

| Class | What it checks |
|-------|----------------|
| Invalid path UUID | Sentinel non-UUIDs (`not-a-uuid`, `12345`, traversal strings) on every UUID-like path param |
| Empty body | `{}` against endpoints with required fields |
| Missing required | Drop each required field of the request schema in turn |
| Type confusion | string↔number, array↔object swaps on every property |
| Invalid format | Bad `email`/`uri`/`date-time`/`uuid` values per declared format |
| Boundary string | `""`, 10000-char string, unicode/emoji/RTL on string fields |
| Invalid enum / array enum | Unknown enum values; arrays of unknown values (catches the events-style bugs) |

Probes are deterministic — same spec → same suites — so generated YAML can be
committed as a regression test. Each probe expects status in
`[400, 401, 403, 404, 405, 409, 415, 422]`; a 5xx (or unexpected 2xx) is a
test failure surfaced via the regular runner / reporter / `zond db diagnose`.

**Cleanup of leaked resources.** A probe that *unexpectedly* returns 2xx on a
mutating endpoint (POST/PUT/PATCH) means the API silently accepted bad input
and created a resource. To keep probe runs idempotent in environments without
namespace isolation, `probe-validation` pairs every mutating probe with a
follow-up `DELETE` step (`always: true`) that fires only if the probe captured
a resource id. When the API correctly rejects the probe with 4xx, the cleanup
step is skipped automatically. If the spec defines no DELETE counterpart for a
mutating endpoint, the generator prints a warning so you can clean up by hand.
Use `--no-cleanup` to opt out (e.g. for staging environments that dump-and-reset
between runs).

### `probe-methods` — bug-hunting HTTP method completeness sweep

A correctly-implemented API returns **405 Method Not Allowed** (or 404) for
HTTP methods not declared on a path — never **5xx** (unhandled exception) and
never **2xx** (forgotten/shadowed route). `probe-methods` generates one suite
per path that probes every method in `{GET, POST, PUT, PATCH, DELETE}` not
declared in the spec.

```bash
zond probe-methods openapi.json --output bugs/method-probes/
zond run bugs/method-probes/              # any 5xx or 2xx failure → bug
zond db diagnose <run-id>
```

Path placeholders are substituted with valid-shape sentinels (zero-UUID for
`format: uuid`, etc.) so the request reaches the routing layer rather than
being rejected purely on path syntax. Body-bearing methods carry a minimal
`{}` JSON body. Each probe expects status in `[401, 403, 404, 405]`; anything
else is a test failure. Probes are deterministic — same spec → same suites —
so generated YAML can be committed as a regression test.

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

### Cleanup steps (`always: true`)

When a step's assertions fail, captures from that step become **tainted** — their values were extracted from the response, but the step itself failed. By default, downstream steps that reference a tainted capture are cascade-skipped to avoid using values from a broken context.

For cleanup steps (DELETE, teardown), this is the wrong default — you want them to run regardless, so the API isn't left with leaked state. Mark them `always: true`:

```yaml
- name: Create resource
  POST: /things
  expect:
    status: 201
    body:
      id: { capture: thing_id }

- name: Cleanup
  DELETE: /things/{{thing_id}}
  always: true            # runs even if Create failed assertions
  expect:
    status: 200
```

Skip semantics with `always: true`:

| Capture state | Non-always | always: true |
|---|---|---|
| Extracted, prior assertions passed | runs | runs |
| Extracted, prior assertions failed (**tainted**) | skip | **runs** |
| Not in response (**missing**) | skip | skip |
| Network/runtime error in source step | skip | skip |

`skip_if` is honored independently of `always` — explicit user skips still fire.

`zond generate` automatically marks DELETE and Verify-deleted steps in CRUD suites as `always: true`, so failed CREATE/UPDATE assertions don't leak resources into the API.

### Assertions

`equals`, `type`, `capture`, `contains`, `matches`, `gt`, `lt`, `exists` (boolean). Nested: `category.name: { equals: "Dogs" }`. Root body: `_body: { type: "array" }`.

**Type values:** `string | integer | number | boolean | array | object | null`. Use `type: "null"` to assert a field is explicitly null.

**Exists semantics:** `exists: true` means *key is present in the response*, including when the value is `null`. To assert "present and not null", combine: `{ exists: true, not_equals: null }` or use `type: "string"` (or whichever non-null type you expect).

**Field name conflicts with assertion keys:** if your response has a field literally named `type`, `equals`, `length`, etc. — use **quoted dot-notation** so the parser treats it as a path, not a rule:

```yaml
expect:
  body:
    "user.type": { equals: "admin" }   # asserts user.type === "admin"
    "data.length": { gt: 0 }           # asserts data.length > 0
```

`status` accepts a single integer (`200`) or an array of allowed codes (`[200, 204]`).

### Suite Variable Isolation

Each suite runs in its own variable scope. Captured variables do **not** propagate between suites. If multiple suites need `auth_token`, each must include its own login step or use a pre-set value from `.env.yaml`.

### Parameterize (suite-level cross-product)

Run the same suite body once per binding in `parameterize` instead of copy-pasting tests. Each key contributes one variable; multiple keys produce the cross-product.

```yaml
name: list-shape contract
parameterize:
  endpoint: [/emails, /domains, /webhooks, /broadcasts, /contacts]
tests:
  - name: "list shape on {{endpoint}}"
    GET: "{{endpoint}}"
    expect:
      status: 200
      body:
        object: { equals: list }
        data:   { type: array }
        has_more: { type: boolean }
```

The example expands to five test runs (one per `endpoint`). Test names are interpolated, so reporters and `zond db diagnose` can distinguish iterations.

Multiple keys → cross-product:

```yaml
parameterize:
  endpoint: [/emails, /domains]
  variant:  [GET, HEAD]
# 4 iterations: /emails+GET, /emails+HEAD, /domains+GET, /domains+HEAD
```

Captures and tainted/missing-capture state are reset between iterations — values captured in iteration 1 are not visible in iteration 2. This matches `zond use`-style isolation but applied per binding inside a single suite. Use `parameterize` for read-only contract checks across many endpoints; for data-driven CRUD inside one HTTP step, prefer `for_each` on the step.

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

| Helper | Output | Maps to OpenAPI `format` |
|---|---|---|
| `{{$uuid}}` | UUID v4 | `uuid` |
| `{{$timestamp}}` | unix seconds (number) | — |
| `{{$isoTimestamp}}` | ISO 8601 datetime | — |
| `{{$randomInt}}` | random integer 0–9999 | — |
| `{{$randomString}}` | 8 random alphanumerics | — |
| `{{$randomName}}` | random first/last name | — |
| `{{$randomEmail}}` | `xxxxxxxx@test.com` | `email` |
| `{{$randomUrl}}` | `https://example-xxxxxxxx.com/path` | `uri`, `url` |
| `{{$randomFqdn}}` | `test-xxxxxxxx.example.com` | `hostname` |
| `{{$randomIpv4}}` | `10.x.x.x` | `ipv4` |
| `{{$randomDate}}` | `YYYY-MM-DD` (today) | `date` |
| `{{$randomIsoDate}}` | ISO 8601 datetime (now) | `date-time` |

`zond generate` picks the right helper from `format` automatically; falls back to property-name heuristics, then `{{$randomString}}`.

### Environments

Environments are file-only. `loadEnvironment(envName?, searchDir)` looks for:
- `.env.yaml` (when no `envName` given)
- `.env.<envName>.yaml` (when `envName` given)

Search order: `searchDir`, then parent directory. As a final fallback for `zond run`, when `--env` is **not** given and neither directory above contains `.env.yaml`, the runner also tries `$PWD/.env.yaml` (with a one-line `zond: using ./.env.yaml (cwd fallback)` notice on stderr). This lets you `cd` into a collection and run an absolute-path test file without `--env-var base_url=…` boilerplate.

```yaml
# .env.staging.yaml
base_url: https://staging.example.com/api
token: staging-token
```

```bash
zond run tests/ --env staging
```

`zond init` creates a `.gitignore` with `.env*.yaml` in the API directory to prevent secrets from being committed.

### Rate limiting & 429 handling

`zond run` throttles outgoing requests when a limit is configured and automatically retries on `429 Too Many Requests`.

- **CLI:** `--rate-limit <N>` caps the run at N requests per second across all suites.
- **`.env.yaml`:** add a top-level `rateLimit: <N>` field — picked up automatically when no CLI flag is given. CLI takes precedence.
- **Auto retry on 429:** the runner respects the `Retry-After` header (seconds or HTTP-date). If the header is missing, it falls back to capped exponential backoff (base = `retry_delay`, cap = 30s). Up to 5 attempts per request, then the 429 is reported as the final response.
- **Adaptive throttling from response headers (`--rate-limit auto`):** zond reads the standard `RateLimit-Remaining` / `RateLimit-Reset` headers (RFC draft `draft-ietf-httpapi-ratelimit-headers`) plus the GitHub/Stripe-style `X-RateLimit-*` aliases on every response. When `remaining` drops to ≤5, subsequent requests are paused until the window resets. `--rate-limit auto` starts with no static cap and lets the API's headers do the throttling — useful for `zond probe-validation` runs against production APIs where the right cap isn't known up front. A static `--rate-limit N` still benefits from the same headers (the cap is the floor; headers can push pauses out further).

> **Tip:** set `--rate-limit` **1 below** the API's documented cap (e.g. use `4` for an API that allows 5 req/s). The throttle paces requests at `1000/N` ms intervals — at exactly N, sliding-window APIs may still return 429 on boundary milliseconds. A small margin avoids it. If the API exposes `RateLimit-*` headers, prefer `--rate-limit auto` and skip the guesswork.

```yaml
# .env.yaml
base_url: https://api.resend.com
api_key: re_xxx
rateLimit: 5  # ≤ 5 req/s
```

```bash
zond run apis/resend/tests --rate-limit 5
```

---

## Bootstrapping a workspace

In a fresh directory, run `zond init` (no flags) to scaffold a zond workspace:

```bash
mkdir my-api-tests && cd my-api-tests
zond init                                    # creates zond.config.yml, apis/, AGENTS.md
```

Pass `--no-agents-md` to skip writing `AGENTS.md` (only `zond.config.yml` + `apis/` will be created).

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

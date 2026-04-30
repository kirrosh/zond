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

All spec-consuming commands (`catalog`, `describe`, `guide`, `generate`,
`probe-*`, `lint-spec`, `sync`) accept either a positional `<spec>` path/URL
**or** `--api <name>` to use the workspace-local snapshot at
`apis/<name>/spec.json`. If neither is given, they fall back to the API
selected via `zond use`.

| Command | Description | Key flags |
|---------|-------------|-----------|
| `init` | Bootstrap a workspace (`zond.config.yml`, `apis/`, `AGENTS.md`, `.claude/skills/`) | `--no-agents-md`, `--no-skills` |
| `add api <name>` | Register an API: copy spec into `apis/<name>/spec.json` and emit catalog/resources/fixtures artifacts | `--spec <path\|url>`, `--base-url`, `--force`, `--insecure`, `--db` |
| `refresh-api <name>` | Re-snapshot spec.json + regenerate the 3 artifacts | `--spec <path\|url>`, `--insecure` |
| `doctor` | Fixture gaps in `.env.yaml` + artifact freshness vs spec.json (exit 0/1/2) | `--api <name>` |
| `run <path>` | Run tests | `--env`, `--safe`, `--tag`, `--bail`, `--dry-run`, `--env-var KEY=VAL`, `--rate-limit <N>`, `--validate-schema`, `--spec <path>`, `--session-id <id>`, `--report json\|junit`, `--report-out <file>` |
| `session start\|end\|status` | Group multiple `zond run` calls into one campaign in `/runs` Sessions view | `--label <text>`, `--id <uuid>` |
| `validate <path>` | Validate YAML tests | |
| `coverage` | API test coverage | `--spec`, `--tests`, `--api`, `--fail-on-coverage <N>` |
| `serve` | Web dashboard (health strip, endpoints/suites/runs tabs) | `--port`, `--watch`, `--kill-existing` |
| `ci init` | Generate CI/CD workflow | `--github`, `--gitlab`, `--dir`, `--force` |
| `probe-validation [spec]` | Generate negative-input probe suites (catch 5xx-on-bad-input) | `--api <name>`, `--output <dir>`, `--tag`, `--max-per-endpoint <N>`, `--no-cleanup` |
| `probe-methods [spec]` | Generate negative-method probe suites (catch 5xx/2xx on undeclared methods) | `--api <name>`, `--output <dir>`, `--tag` |
| `probe-mass-assignment [spec]` | Live probe for privilege-escalation via extra payload fields (`is_admin`, `role`, …) | `--api <name>`, `--env <file>`, `--output <md>`, `--emit-tests <dir>`, `--tag`, `--no-cleanup`, `--timeout <ms>` |
| `lint-spec [spec]` | Static analysis of OpenAPI for internal-consistency and strictness gaps (zero HTTP) | `--api <name>`, `--strict`, `--rule <list>`, `--config <path>`, `--include-path <glob>`, `--max-issues <N>`, `--ndjson`, `--no-db` |
| `catalog [spec]` | Standalone build of `.api-catalog.yaml` (registered APIs already have one in `apis/<name>/`) | `--api <name>`, `--output <dir>` |
| `describe [spec]` | Describe endpoints from OpenAPI spec | `--api <name>`, `--compact`, `--list-params`, `--method`, `--path` |
| `guide [spec]` | Generate test-generation guide from OpenAPI spec | `--api <name>`, `--tests-dir`, `--tag` |
| `generate [spec]` | Autogenerate test suites | `--api <name>`, `--output`, `--tag`, `--uncovered-only` |
| `sync [spec]` | Detect new/removed endpoints and generate tests for new ones (for refreshing artifacts use `refresh-api`) | `--api <name>`, `--tests`, `--dry-run`, `--tag` |
| `report export <run-id>` | Export a stored run as a single-file shareable HTML report | `-o, --output <file>`, `--db <path>` |
| `report case-study <failure-id>` | Generate a markdown case-study draft for a single failure | `-o, --output <file>`, `--db <path>` |

> **Deprecated**: `zond init --spec <path> --name <api>` (and `--with-spec`) still
> work but print a stderr warning. Prefer `zond init` followed by
> `zond add api <name> --spec <path>`.

### `lint-spec` — static OpenAPI analysis (pre-flight, zero HTTP)

A lot of "API bugs" are visible in the spec itself, before any test runs.
`zond lint-spec` walks the OpenAPI document once and reports two ortho­gonal
classes of problems:

- **Group A — internal consistency.** The spec contradicts itself: an
  `example` violates its own `format`, an `enum` member is duplicated, a
  `default` falls outside `minimum`/`maximum`. Schemathesis-style fuzzing
  would eventually hit these too — `lint-spec` finds them deterministically
  in milliseconds.
- **Group B — strictness gaps.** The schema is too loose: a path-param has
  no `format` or `pattern`; an integer query-param (`limit`, `offset`) has
  no `minimum`/`maximum`; a 2xx response has no JSON schema; a request body
  doesn't declare `additionalProperties`. SDKs generated from such specs
  silently send invalid data and the server rejects it with 422.

```bash
zond lint-spec openapi.json                                # human report
zond lint-spec openapi.json --json | jq '.data.issues'      # structured
zond lint-spec openapi.json --rule '!B2,!B5,!B6,!B9'        # disable heuristics
zond lint-spec openapi.json --config .zond-lint.json        # per-project rules
```

| Group | Rule | Severity (default) | What it checks |
|---|---|---|---|
| A | A1 | high | `example` matches `format` (strict RFC3339 for `date-time`, plus `email`/`uri`/`uuid`/`ipv4`/`hostname`) |
| A | A2 | high | `example` matches `enum` |
| A | A3 | medium | `example` matches `pattern` |
| A | A4 | medium | `example` respects `minLength`/`maxLength`/`minimum`/`maximum` |
| A | A5 | medium | `default` respects all of the above |
| A | A6 | low | `enum` members are pairwise unique |
| B | B1 | high | string path-param has neither `format` nor `pattern` |
| B | B2 | low (heuristic) | id-like param (`*_id`) without `format: uuid` or `pattern` |
| B | B3 | medium | integer query-param without `minimum`/`maximum` (medium for pagination names, low otherwise) |
| B | B4 | low | cursor-style param (`after`/`before`/`cursor`) without `minLength: 1` |
| B | B5 | medium (heuristic) | `*_at`/`*_date`/`created`/`updated` field without `format: date-time` |
| B | B6 | low (heuristic) | `email`/`url`/`website` field without matching `format` |
| B | B7 | high | 2xx response has no JSON schema (`--validate-schema` would silently skip it). 204/205 are exempt by definition |
| B | B8 | low | request body schema doesn't declare `additionalProperties` |
| B | B9 | low (heuristic) | request body has `name`/`email`/`title` properties but `required` is empty |

Heuristic rules (B2/B5/B6/B9) are name-based and configurable via
`.zond-lint.json` (see `heuristics.id_suffixes` etc). Disable any rule with
`--rule !B2`; force a severity with `--rule B8=high`.

**RFC6901 jsonpointer.** Every issue carries a `jsonpointer` field pointing
to the exact node in the spec — agents and IDEs can open the source location
without re-parsing the document.

**`affects`** (JSON output only). Each issue lists which other zond commands
become noisy or unreliable while this issue is unfixed. For example, an
unfixed B1 surfaces as `affects: ["probe-validation:invalid-path-uuid"]`,
predicting which `probe-validation` runs will produce false-positive 5xx
because the spec didn't pin a format. This is the runtime-aware angle no
generic OpenAPI linter offers.

```jsonc
// --json output, single issue
{
  "rule": "B1",
  "severity": "high",
  "path": "/webhooks/{id}",
  "method": "GET",
  "jsonpointer": "/paths/~1webhooks~1{id}/get/parameters/0",
  "message": "path-param \"id\" missing format/pattern",
  "fix_hint": "add format: uuid (or pattern: ^...$) so SDKs reject malformed values client-side",
  "affects": ["probe-validation:invalid-path-uuid", "probe-methods"]
}
```

**Exit codes:**

- `0` — no issues, or only LOW issues without `--strict`.
- `1` — at least one HIGH (CI fail).
- `2` — at least one MEDIUM (or LOW with `--strict`); also for usage errors.

**SQLite history.** Each lint run is recorded in the `lint_runs` table for
future `zond db lint-diff`. Disable with `--no-db`.

**Config (`.zond-lint.json`, optional):**

```json
{
  "rules": { "B2": "off", "B5": "low" },
  "heuristics": {
    "id_suffixes": ["_id", "Id"],
    "timestamp_suffixes": ["_at", "_date"],
    "url_names": ["url", "website", "homepage"]
  },
  "ignore_paths": ["/internal/*"]
}
```

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

### `probe-mass-assignment` — privilege-escalation hunt

Mass assignment is the class where an API silently accepts client-supplied
fields that should be server-controlled — `is_admin`, `role`, `account_id`,
`owner_id` — and either *applies* them (privilege escalation) or *ignores*
them (silent acceptance, latent risk). Unlike the other probes,
`probe-mass-assignment` runs **live** against a real API: the only way to
distinguish "applied" from "ignored" is to read back the resource via a
follow-up GET.

```bash
zond probe-mass-assignment openapi.json \
  --env .env.yaml \
  --output digest.md \
  --emit-tests probes/mass-assignment/
```

For every POST endpoint (and PATCH/PUT when env supplies path-param values)
the probe sends one request whose body is the spec-baseline payload merged
with two extra-field families:

| Family | Examples | Why |
|--------|----------|-----|
| Suspected | `is_admin: true`, `role: "admin"`, `is_system: true`, `verified: true`, `account_id`, `owner_id`, `user_id` | Classic mass-assignment vectors — fields that, if writable, escalate privileges |
| Server-assigned | `id`, `created_at`, `updated_at`, `object` (lifted from the 2xx response schema if absent in the request schema) | If the server uses the client-supplied value here instead of generating its own, that's a takeover/forgery bug |

The response (and follow-up GET, when a `GET /resource/{id}` counterpart
exists) classifies each endpoint into one of:

| Severity | Outcome | Meaning |
|----------|---------|---------|
| 🚨 HIGH | accepted-and-applied | Suspicious value persisted — privilege escalation candidate. Or 5xx — unhandled exception. Also covers **extras-bypass** (baseline 4xx but injected 2xx — extras opened a code path the baseline never reached). |
| ⚠️ INCONCLUSIVE | baseline-failure | Both the no-extras baseline POST *and* the with-extras POST returned 4xx — the API rejected the request before validation reached the extras. Almost always a missing fixture (FK id, scope, path-param). The digest surfaces the server's error message verbatim so you know which value to set. Excluded from `--emit-tests` on purpose: locking in a baseline-broken endpoint would make CI 404 every run and mask real regressions. |
| ⚠️ MEDIUM | inconclusive (no-GET) | 2xx but no GET counterpart in the spec to verify persistence. |
| ℹ️ LOW | accepted-and-ignored | 2xx, follow-up GET shows the field was silently dropped. Soft-warn — server should reject explicitly. |
| ✅ OK | rejected (4xx) | Baseline 2xx + injected 4xx — extras genuinely refused. Bonus credit when request schema declares `additionalProperties: false`. |
| ⏭ SKIPPED | — | No JSON body, or PATCH/PUT without a resolvable path id. |

**Why the baseline probe.** Without it, a 4xx caused by FK miss / bad
fixture / scope mismatch is indistinguishable from a 4xx that actually
rejected our extras — false-OK on FK-heavy SaaS APIs (Stripe / Linear /
GitHub / Resend, anywhere POSTs reference parent resources). Each
endpoint pays one extra request: baseline first, then injected. If
baseline 2xx, the resource is auto-DELETE'd before the injected probe
fires (so the second POST doesn't trip a unique-constraint).

Output is a Markdown digest grouped by severity (stdout by default; `--output
<file>` writes to disk). Exit code is non-zero (`1`) when at least one HIGH
finding exists — useful for CI gating.

**Cleanup.** When a 2xx response leaks a real resource and the spec defines a
`DELETE /resource/{id}` counterpart, the probe issues a follow-up DELETE
automatically. Use `--no-cleanup` for namespace-isolated test environments
that dump-and-reset.

**`--emit-tests <dir>`** writes a YAML regression suite that locks in the
*observed safe* behaviour: rejected endpoints get a probe asserting `status ∈
[400,401,403,409,415,422]`; ignored endpoints get a POST + GET pair asserting
the suspicious field did not echo back, plus an `always: true` cleanup
DELETE. Endpoints classified HIGH or MEDIUM are deliberately not emitted —
those are bugs to fix, not baselines to lock. Run the resulting suite via
`zond run <dir> --env .env.yaml` on CI.

**Auth / config.** Live probing requires `--env <file>`; the YAML must at
least set `base_url`. Bearer / API-key tokens are read from `auth_token` /
`api_key` (matching `zond run`'s convention). Path-param placeholders
(e.g. `{orgId}`) are substituted from the same env — set them explicitly to
unlock PATCH/PUT probing.

---

### `report export` — single-file shareable HTML run reports

After a run lives in SQLite (`zond.db`), `zond report export <run-id>`
materialises it as a self-contained HTML file you can drop into a Slack
thread, attach to a GitHub issue, or open offline weeks later — no
`zond serve` required.

```bash
zond report export 42                       # → zond-run-42.html
zond report export 42 -o triage/run-42.html # custom path
zond report export 42 --db ./other.db       # alt DB file
```

The output is a single `.html` with **inline CSS and JS, zero external
assets** (no fonts, no CDN scripts) so it renders identically in any
browser, behind corporate proxies, or in `file://`. Light + dark themes
auto-switch via `prefers-color-scheme`; print-friendly CSS is included for
PDF export from the browser.

What's inside, top-to-bottom:

1. **Run summary hero** — pass-rate ring (colour-coded by threshold),
   spec name, base_url, started/finished/duration, branch + short commit.
2. **KPI strip** — total / passed / failed / errored / skipped counters.
3. **Failure cards** — one per failed/errored step, collapsible, with:
   - method + endpoint + HTTP status badge,
   - failure_class badge (`definitely_bug` / `likely_bug` / `quirk` /
     `env_issue`) and reason on hover,
   - **Copy curl** button for one-line repro,
   - **Copy as GitHub issue** button — emits ready-to-paste markdown
     with method/URL, status, failure class, curl block, response body,
     OpenAPI pointer, and a list of failed assertions,
   - tabbed evidence panel: Response (headers + body, JSON-highlighted),
     Request, Assertions, Source (provenance + frozen spec excerpt).
4. **Filter chips** by failure_class (e.g. show only `definitely_bug`).
5. **Coverage map** — endpoint × method matrix, colour-coded by worst
   observed status class (2xx / 4xx / 5xx / network err).
6. **Footer** — zond version, generation timestamp, project link.

Typical size: a 50-endpoint run lands in 50–150 KB. `--json` envelope
output is supported and includes `sizeKb`, `output`, `failures`, and
`totalSteps`. Exit codes: `0` ok, `1` run-id not found, `2` invalid
input.

---

### `report case-study` — markdown draft for one failure

`zond report export` gives you the full HTML run; `zond report case-study
<failure-id>` zooms in on **one** failure and produces a markdown draft
ready to drop into a tracker, blog post, or Slack write-up. Every session
should leave behind one such artefact — this command removes the friction
of starting from a blank page.

```bash
zond report case-study 2                 # print to stdout
zond report case-study 2 -o draft.md     # write to file
zond report case-study 2 | gh issue create --title "POST /pets 5xx" --body-file -
```

`<failure-id>` is the `results.id` (one row per step, not the run-id).
Find one via `zond db run <run-id>` — failed/errored rows are the obvious
candidates. The same draft is also reachable from `zond serve` →
Run detail → **Case study draft** button on each failure card (writes
to clipboard via `GET /api/results/:id/case-study.md`).

The template fills itself from existing run data:

- **TL;DR** — chosen by `failure_class` (`definitely_bug` /
  `likely_bug` / `quirk` / `env_issue`), each gets a different one-liner.
- **Context** — API title + version pulled from the registered
  collection's OpenAPI `info` (best-effort: if the spec is unreachable
  at export time the field becomes `<TODO: ...>` instead of failing).
- **What the spec says** — JSON pointer + frozen excerpt captured at
  run time (so later spec edits don't rewrite history).
- **Repro** — the same `curl` block as the HTML report.
- **What happened** — status + duration + pretty-printed response body.
- **Why it matters** — `failure_class_reason` + every failed assertion
  expanded as `expected vs actual`.
- **How zond found it** — provenance (which generator, which response
  branch, which suite).

Anything zond couldn't determine becomes an explicit `<TODO: ...>`
placeholder so you immediately see the gaps to fill in by hand. Exit
codes match the rest of the family: `0` ok, `1` failure-id not found,
`2` invalid input.

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
- **Adaptive throttling from response headers (`--rate-limit auto`):** zond reads the standard `RateLimit-Remaining` / `RateLimit-Reset` headers (RFC 9568, formerly `draft-ietf-httpapi-ratelimit-headers`) plus the GitHub/Stripe-style `X-RateLimit-*` aliases on every response. Two complementary mechanisms keep parallel suites from blowing through small windows:
  - **Window-aware spacing (TASK-88):** when the response carries `RateLimit-Policy: N;w=W` (e.g. Resend's `5;w=1`), the limiter learns a per-request interval of `(W/N) * 1000 + 50ms` safety. Subsequent acquires — even from suites running in parallel — are paced one-by-one at that interval, so a burst of 10 simultaneous requests fans out to ten ~200ms steps instead of overshooting in the first 50ms. The strictest policy wins when several are advertised. `IntervalRateLimiter` (static `--rate-limit N`) tightens too if the server's policy is more restrictive than the user-supplied cap; it never loosens below the cap.
  - **Reset-window pause:** when `remaining` drops to ≤2, subsequent requests are pinned to wait until the API's `reset` window expires.
  
  `--rate-limit auto` starts with no static cap and lets the API's headers do the throttling — useful for `zond probe-validation` and `zond probe-mass-assignment` runs against production APIs where the right cap isn't known up front.

> **Tip:** prefer `--rate-limit auto` whenever the API exposes `RateLimit-Policy` — the limiter learns the right spacing on the first response. For APIs that omit the policy header, set `--rate-limit` **1 below** the documented cap (e.g. use `4` for an API that allows 5 req/s) — at exactly N, sliding-window APIs may still return 429 on boundary milliseconds.

```yaml
# .env.yaml
base_url: https://api.resend.com
api_key: re_xxx
rateLimit: 5  # ≤ 5 req/s
```

```bash
zond run apis/resend/tests --rate-limit 5
```

### Response-schema validation (`--validate-schema`)

`zond run --validate-schema` validates every JSON response body against the
declared OpenAPI response schema (matched by path + method + status). Any
mismatch surfaces as an extra assertion failure on the step — alongside your
explicit YAML expectations — and follows the normal reporter / DB / `--report`
pipeline.

What's checked: `type`, `required`, `enum`, `format` (`email`, `uri`, `uuid`,
`date-time`), `additionalProperties` (only when the spec sets it), `oneOf` /
`anyOf`, plus every nested `$ref`. OpenAPI 3.0 (`nullable: true`) and 3.1
(`type: ["string", "null"]`) are both supported.

`format: date-time` is enforced strictly per RFC3339 §5.6: `T` is required as
the separator (space is rejected), and the offset must be `Z` or `±HH:MM` with
an explicit colon. PostgreSQL-style values like `"2026-04-29 07:10:44.674675+00"`
fail validation — they break strict RFC3339 clients (e.g. Go `time.RFC3339`)
even when JS `new Date()` accepts them.

```bash
# explicit spec
zond run apis/resend/tests --spec apis/resend/openapi.json --validate-schema

# spec resolved from the collection (set during `zond generate` / `zond use`)
zond run --api resend --validate-schema
```

For 4xx / 5xx responses zond falls back to `responses.<NXX>` then
`responses.default` if a status-specific schema isn't declared. Endpoints
without a JSON response schema are skipped silently.

If `--validate-schema` is passed without `--spec` and the active collection has
no `openapi_spec`, the run exits with code 2.

---

## Bootstrapping a workspace

```bash
mkdir my-api-tests && cd my-api-tests
zond init                                              # workspace: zond.config.yml + apis/ + AGENTS.md + .claude/skills/
zond add api my-api --spec ./openapi.json              # register: copies spec into apis/my-api/spec.json + emits 3 artifacts + .env.yaml
zond doctor --api my-api                               # report what to fill in apis/my-api/.env.yaml
```

`zond init` is idempotent — re-running re-emits skill files and updates the
`<!-- zond:start --> / <!-- zond:end -->` block in `AGENTS.md` without
touching surrounding content.

Pass `--no-agents-md` or `--no-skills` to skip the corresponding template.

> **Deprecated**: `zond init --spec <path> --name <api>` and `zond init
> --with-spec <path>` still bootstrap + register in one step but print a
> stderr warning. New scripts should use the two-step `zond init` +
> `zond add api`.

---

## Workspace

zond resolves the workspace root via walk-up from the current directory. The first ancestor containing any of these markers is treated as the root:

1. `zond.config.yml`
2. `.zond/` directory
3. `zond.db`
4. `apis/` directory

The walk stops at `$HOME` to avoid accidentally adopting `~/apis` or `~/zond.db` when zond is invoked from an unrelated directory. If no marker is found, zond falls back to the current directory and prints a one-time warning to stderr — run `zond init` (or create `zond.config.yml`) to anchor the workspace explicitly.

The workspace root is used as the default location for `zond.db`, the `apis/<name>/` directory created by `zond add api`, and the `.zond-current` file written by `zond use`. Explicit `--db` and `--dir` flags always win over walk-up.

### Per-API artifacts (`apis/<name>/`)

`zond add api` and `zond refresh-api` produce a self-contained set of files
agents and tools read instead of the raw spec — keeps token cost bounded
and makes API drift git-visible.

| File | Role | Read by |
|------|------|---------|
| `spec.json` | Dereferenced OpenAPI snapshot — canonical machine source. | `generate`, `probe-*`, `--validate-schema`, anything that needs full schemas. |
| `.api-catalog.yaml` | Compressed endpoint index (method/path/params/compressed schemas). | Skill prose, `describe`, `guide`. **Cheap to read.** |
| `.api-resources.yaml` | CRUD chains: idParam, captureField, FK dependencies, ETag/soft-delete flags, orphan endpoints. | Scenario authoring, audit setup. |
| `.api-fixtures.yaml` | Required `{{vars}}` classified by source (server/auth/path/header) with descriptions and affected-endpoint lists. | `zond doctor`, scenarios skill. |
| `.env.yaml` | User-provided values for the fixture manifest. Auto-gitignored. | Every test run. |

The `.api-*.yaml` files are read-only — regenerate via
`zond refresh-api <name>`. `collections.openapi_spec` in the SQLite DB now
stores the workspace-relative path to the local snapshot
(`apis/<name>/spec.json`), so workspaces are portable.

`zond doctor [--api X]` is the one-shot health check: surfaces missing
fixtures, stale artifacts (specHash mismatch), and missing snapshots in
one report. JSON envelope mode (`--json`) is the integration point for
agents.

### Sessions — group multiple runs into one campaign

A "session" stitches multiple `zond run` invocations under one `session_id` so the dashboard's `/runs` view collapses them into a single row instead of N scattered runs. Use it when running a typical sweep — `smoke + probe-methods + probe-validation + mass-assignment` — and you want them grouped as one campaign.

```bash
zond session start --label "post-deploy sweep"   # writes UUID to .zond/current-session
zond run apis/resend/tests --tag smoke            # auto-picks up the session
zond run apis/resend/probes/methods               # same session
zond run apis/resend/probes/validation            # same session
zond session end                                  # removes .zond/current-session
zond session status                               # show what's active
```

`session_id` resolution order in `zond run`:

1. `--session-id <uuid>` flag (explicit override)
2. `ZOND_SESSION_ID` env var (CI-friendly)
3. `.zond/current-session` file (set by `zond session start`)

If none of those is set, the run is "ad-hoc" and shows up alone in `/runs`. Old runs without `session_id` continue to render in the legacy `Runs` tab.

### `zond serve` port handling

By default, `zond serve` is non-destructive: if the requested port (`--port` or 8080) is busy, it scans the next 10 ports and binds the first free one, printing the chosen port to stderr. If the entire 11-port range is busy, it exits 1 with instructions.

Pass `--kill-existing` to restore the legacy behaviour of terminating whichever process holds the requested port. Use with care — it will kill your dev backend if it happens to listen there.

---

## CI/CD

`zond ci init` scaffolds GitHub Actions or GitLab CI workflow. Supports schedule, repository_dispatch, manual triggers. See [docs/ci.md](docs/ci.md).

---

## Exit codes

zond uses a small, stable taxonomy so CI and oncall scripts can branch on `$?`
without grepping logs.

| Code | Meaning |
|------|---------|
| `0`  | success |
| `1`  | assertion / probe failure (test artifact, **not** a zond bug) |
| `2`  | usage, config, or spec error (zond couldn't run the test) |
| `3`  | internal zond error — uncaught throw, escapes command handler. Always prefixed with `[zond:internal]` and includes version + stack hash |
| `4+` | reserved for future classes (network, schema, …) |

Codes ≥ `128` come from the OS, not zond — typically `137` (SIGKILL: OOM
killer / Gatekeeper / sandbox) or `143` (SIGTERM). Anything in this range
means the process was killed externally:

```bash
zond run apis/foo/tests
rc=$?
if   [ $rc -eq 0   ]; then echo "ok"
elif [ $rc -eq 1   ]; then echo "test failure"
elif [ $rc -eq 2   ]; then echo "usage/config error"
elif [ $rc -eq 3   ]; then echo "zond internal bug — file an issue"
elif [ $rc -ge 128 ]; then echo "killed by signal $((rc - 128))"
fi
```

JSON envelopes from `--json` carry the same code in `exit_code` on errors.

---

## `--json` envelope

Most subcommands accept `--json` (or, for `run`, `--report json`) and emit a
single uniform envelope so a downstream parser only needs one shape:

```jsonc
{
  "ok": true,            // false on errors[].length > 0
  "command": "db diagnose",
  "data": { /* command-specific payload */ },
  "warnings": [ /* string[], non-fatal */ ],
  "errors":   [ /* string[], populated when ok=false */ ]
}
```

Holds for `db collections|runs|run|diagnose|compare`, `validate`, `coverage`,
`generate`, `probe-*`, `request`, `init`, `describe`, `use`, `sync`, `update`,
`postman`, `catalog`, `guide`. The `data` payload shape varies by command (e.g.
`db run`'s `data` is `{ run, results }`); the envelope itself does not.

`run` (test execution) is the exception — historically `--json` collided with
`--report json`. Use `--report json` for the report payload; `--report-out
<file>` writes it to disk.

### `db diagnose` envelope — `env_issue`

When the diagnose detector decides that environment misconfiguration (not test
logic, not a backend bug) is the root cause of failures, it surfaces the
finding as a structured `env_issue` field in the `data` payload:

```jsonc
{
  "env_issue": {
    "message": "Suite \"payments\" looks env-broken (missing_var=2) — check .env.yaml",
    "scope": "suite:payments",          // "run" or "suite:<name>"
    "affected_suites": ["payments"],    // suites that were re-classified to fix_env
    "symptoms": {                       // histogram of root-cause classes
      "missing_var": 2,                 // unresolved {{var}} in URL/body/headers
      "base_url": 0,                    // base_url unset or empty
      "url_malformed": 0,               // computed URL is not parseable
      "auth_expired": 0                 // 401/403 with auth-header reference
    }
  }
}
```

`scope` semantics:
- `run` — multiple suites tripped the detector; the run as a whole is
  env-broken. Often paired with a "missing base_url"/expired-token symptom
  set.
- `suite:<name>` — only one suite tripped the detector. The other suites'
  failures keep their original `recommended_action` (e.g. `fix_test_logic`).

5xx failures are **never** rewritten to `fix_env` — `report_backend_bug` wins
even when the surrounding suite is otherwise env-broken.

---

## Principles

1. **One file** — download binary, run. No Docker, no npm.
2. **Tests as code** — YAML in git, code review, CI/CD.
3. **OpenAPI-first** — spec exists → tests generate.
4. **AI-native** — skills for Claude Code agents, CLI for humans, same engine.
5. **SQLite by default** — history works out of the box.

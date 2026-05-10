# ZOND

**AI-native API testing tool** — OpenAPI spec → test generation → execution → diagnostics. One binary. Zero config.

- **CLI** — primary interface for Claude Code agents and CI/CD

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

For each tag the generator emits up to **four** smoke suites:

- `<tag>-smoke` — paramless GETs (list/health endpoints), runs unconditionally.
- `<tag>-smoke-negative` — single-resource GETs (`/users/{id}` shape) called with a guaranteed-bad ID. Expects `[400, 404, 422]`. Verifies routing, auth, and base URL are wired up.
- `<tag>-smoke-positive` — same endpoints called with `{{param}}` from `.env.yaml`. Tagged `[smoke, positive, needs-id]`. Each step has `skip_if: "{{param}} =="` — auto-skips while the env var is empty (default after `zond generate`), runs once you fill it in.
- `<tag>-smoke-unsafe` — non-GET endpoints (POST/PUT/PATCH/DELETE) under the same tag. Tagged `[smoke, unsafe]`. **Mutates remote state** — included in `--tag smoke` by default, excluded by `--safe`. Use `--exclude-tag unsafe` (or `--safe`) for read-only smoke runs. `/reset`-style system endpoints are split out into a separate `<tag>-system` suite tagged `[system, reset]` and never run as part of smoke.

The `unsafe` tag marks any suite whose steps are known to mutate state (writes without an idempotency guard). It is orthogonal to `crud` (which groups multi-step CRUD flows): `unsafe` is the per-step write marker, `crud` is the workflow marker.

Filtering recipes:

```bash
zond run apis/x/tests --tag smoke                     # all four (positive auto-skips until IDs set, unsafe mutates)
zond run apis/x/tests --tag smoke --safe              # GET-only smoke — drops smoke-unsafe and any non-GET step
zond run apis/x/tests --tag smoke --exclude-tag unsafe,needs-id   # paramless smoke + negative only
zond run apis/x/tests --tag positive                  # opt-in: requires real IDs in env
zond run apis/x/tests --tag unsafe                    # opt-in: only the write-side smoke suites
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
- `--safe` on `zond run` → only GET requests execute, write ops are skipped (also drops every step in `[smoke, unsafe]` suites)
- `--dry-run` on `zond run` → shows all requests without sending any
- `unsafe` tag → marks individual steps that mutate state; pair it with `--safe` (skip) or `--tag unsafe` (opt-in)
- Always use `tags: [smoke]` for GET-only suites, `tags: [crud]` for write operations
- Never run CRUD tests unless user confirmed environment is safe (staging/test)

---

## CLI Commands

All spec-consuming commands (`catalog`, `describe`, `generate`,
`probe <class>`, `check spec`) accept either a positional `<spec>` path/URL
**or** `--api <name>` to use the workspace-local snapshot at
`apis/<name>/spec.json`. If neither is given, they fall back to the API
selected via `zond use`.

### Active-API resolution (TASK-290)

Every command that accepts `--api <name>` resolves the active API in this order:

1. Per-command `--api <name>` (highest precedence).
2. Global `--api <name>` passed before the subcommand (`zond --api sentry run …`).
3. `ZOND_API` env var (CI-friendly).
4. `.zond/current-api` file, set by `zond use <name>` (workspace default).

If none is set and the workspace has exactly one registered API, that API is
auto-selected; otherwise the command fails with a usage error listing the
registered APIs. Run `zond use` (no args) to see what is currently active.

Commands group around the lifecycle phase they belong to (mirrors `zond --help`):

**Setup**
| Command | Description | Key flags |
|---------|-------------|-----------|
| `init` | Bootstrap a workspace (`zond.config.yml`, `apis/`, `AGENTS.md`, `.claude/skills/`) | `--no-agents-md`, `--no-skills` |
| `add api <name>` | Register an API: copy spec into `apis/<name>/spec.json` and emit catalog/resources/fixtures artifacts | `--spec <path\|url>`, `--base-url`, `--force`, `--insecure`, `--db` |
| `use [api]` | Set/show the active API (writes `.zond/current-api`); see resolution chain above | — |
| `refresh-api <name>` | Re-snapshot spec.json + regenerate the 3 artifacts | `--spec <path\|url>`, `--insecure` |
| `doctor` | Fixture gaps in `.env.yaml` + artifact freshness vs spec.json (exit 0/1/2) | `--api <name>`, `--json` |
| `prepare-fixtures` | Auto-fill `.env.yaml` FK ids — single-pass discover by default; `--cascade` enables the multi-pass discover+seed flow | `--api <name>`, `--apply`, `--verify`, `--refresh`, `--cascade`, `--seed`, `--force`, `--max-passes <n>`, `--env <path>`, `--timeout <ms>`, `--json` |
| `clean` | Remove auto-generated files tracked in `.zond/manifest.json` | `--api <name>`, `--probes`, `--dry-run`, `--force` |
| `cleanup` | Retry probe leftovers; currently only `--orphans` re-issues DELETE for resources captured in `~/.zond/orphans/` | `--orphans`, `--db <path>`, `--json` |

**Run**
| Command | Description | Key flags |
|---------|-------------|-----------|
| `run [paths…]` | Run tests; multi-path/glob OK | `--all`, `--api <name>`, `--env`, `--safe`, `--tag`, `--exclude-tag`, `--method <list>`, `--bail`, `--dry-run`, `--env-var KEY=VAL`, `--auth-token`, `--rate-limit <N\|auto>`, `--timeout <ms>`, `--validate-schema`, `--spec <path>`, `--strict-vars`, `--sequential`, `--quiet`, `--no-db`, `--session-id <id>`, `--learn`, `--learn-apply`, `--learn-target test\|drifts`, `--report json\|junit`, `--report-out <file>` |
| `request <method> <url>` | Ad-hoc HTTP request (also stored in DB) | `--api <name>`, `--header`, `--body`, `--env`, `--auth-token`, `--validate-schema`, `--validate-against`, `--timeout <ms>`, `--json` |
| `session start\|end\|status\|list` | Group multiple `zond run` calls under one `session_id` | `--label <text>`, `--id <uuid>` |
| `audit` | One-shot macro: prepare-fixtures → generate → probes → run → coverage → HTML report | `--api <name>`, `--no-probes`, `--no-html`, `--output <dir>` |

**Analyze**
| Command | Description | Key flags |
|---------|-------------|-----------|
| `check tests <path>` | Schema-validate YAML test files | `--verbose`, `--json` |
| `check spec [spec]` | Static OpenAPI analysis (no HTTP); see [check spec](#check-spec--static-openapi-analysis-pre-flight-zero-http) below | `--api <name>`, `--strict`, `--rule <list>`, `--severity <list>`, `--top <N>`, `--verbose`, `--config <path>`, `--include-path <glob>`, `--max-issues <N>`, `--ndjson`, `--no-db`, `--json` |
| `coverage` | Pass-coverage and hit-coverage side-by-side. Exit 0 = full coverage (or ≥ `--fail-on-coverage`); 1 = uncovered/below threshold; 2 = bad input | `--api <name>`, `--spec`, `--tests`, `--run-id`, `--session-id`, `--union <selector>` (`session\|since:<dur>\|tag:<name>\|runs:<ids>`), `--fail-on-coverage <N>`, `--db <path>`, `--json` |
| `db collections\|runs\|run\|diagnose\|compare` | Query the SQLite history; `db diagnose` is the triage workhorse | `--db <path>`, `--api`, `--limit`, `--status`, `--since`, `--json` |
| `describe [spec]` | List endpoints from a spec | `--api <name>`, `--compact`, `--list-params`, `--method`, `--path` |

**Generate**
| Command | Description | Key flags |
|---------|-------------|-----------|
| `generate [spec]` | Autogenerate test suites; combine with `--uncovered-only` to top up after `refresh-api`. `--explain` prints the CRUD-detection table without writing files | `--api <name>`, `--output`, `--tag`, `--uncovered-only`, `--include-deprecated`, `--force`, `--explain` |
| `probe static [spec]` | Static probes (no HTTP at generation time) — validation (5xx-on-bad-input) + methods (undeclared verbs). Defaults to both classes | `--api <name>`, `--output <dir>`, `--tag`, `--max-per-endpoint <N>`, `--no-cleanup`, `--use-synthetic-parents`, `--include validation,methods`, `--exclude validation,methods` |
| `probe mass-assignment [spec]` | **Live** probe for privilege-escalation via extra payload fields | `--api <name>`, `--env <file>`, `--output <md>`, `--emit-tests <dir>`, `--emit-template <method:path>`, `--tag`, `--no-cleanup`, `--no-discover`, `--timeout <ms>`, `--json` |
| `probe security <classes> [spec]` | **Live** SSRF / CRLF / open-redirect probes with baseline-OK gate; classes = subset of `ssrf,crlf,open-redirect` | `--api <name>`, `--env <file>`, `--output <md>`, `--emit-tests <dir>`, `--tag`, `--no-cleanup`, `--dry-run`, `--isolated`, `--timeout <ms>` |

**Report**
| Command | Description | Key flags |
|---------|-------------|-----------|
| `report export <run-id>` | Export a single stored run as a self-contained HTML (or markdown) | `--format html\|markdown`, `-o, --output <file>`, `--db <path>` |
| `report bundle <range>` | Batch exporter: HTML + markdown digest + diagnose JSON + index for a run-id range | `--include <list>`, `--output <dir>`, `--db <path>` |
| `catalog [spec]` | Standalone build of `.api-catalog.yaml` (registered APIs already carry one) | `--api <name>`, `--output <dir>`, `--json` |

**Other**
| Command | Description | Key flags |
|---------|-------------|-----------|
| `ci init` | Generate GitHub Actions / GitLab CI workflow | `--github`, `--gitlab`, `--dir`, `--force` |
| `completions <shell>` | Print bash/zsh/fish completion script | — |
| `reference <topic>` | Printable references for built-ins; today: `random-helpers` (TASK-267) | — |

> **Deprecated**: `zond init --spec <path> --name <api>` (and `--with-spec`) still
> work but print a stderr warning. Prefer `zond init` followed by
> `zond add api <name> --spec <path>`.

### `check spec` — static OpenAPI analysis (pre-flight, zero HTTP)

A lot of "API bugs" are visible in the spec itself, before any test runs.
`zond check spec` walks the OpenAPI document once and reports two ortho­gonal
classes of problems:

- **Group A — internal consistency.** The spec contradicts itself: an
  `example` violates its own `format`, an `enum` member is duplicated, a
  `default` falls outside `minimum`/`maximum`. Schemathesis-style fuzzing
  would eventually hit these too — `check spec` finds them deterministically
  in milliseconds.
- **Group B — strictness gaps.** The schema is too loose: a path-param has
  no `format` or `pattern`; an integer query-param (`limit`, `offset`) has
  no `minimum`/`maximum`; a 2xx response has no JSON schema; a request body
  doesn't declare `additionalProperties`. SDKs generated from such specs
  silently send invalid data and the server rejects it with 422.

```bash
zond check spec openapi.json                                # rule × severity rollup (TASK-279)
zond check spec openapi.json --verbose                       # legacy flat one-line-per-issue list
zond check spec openapi.json --severity high                 # render only HIGH issues
zond check spec openapi.json --rule B1,B6 --top 10           # whitelist + top-N rules (TASK-291)
zond check spec openapi.json --json | jq '.data.summary'     # structured (issues + summary)
zond check spec openapi.json --rule '!B2,!B5,!B6,!B9'        # disable heuristics
zond check spec openapi.json --rule 'B8=high,B9=low'         # severity overrides + implicit whitelist
zond check spec openapi.json --config .zond-lint.json        # per-project rules
```

> **TASK-291: unified `--rule`.** A single flag now handles severity overrides
> *and* whitelisting. Comma-separated items: `B1` (whitelist), `!B2` (disable),
> `B3=high|medium|low` (override severity, also whitelists `B3`), `B3=off`
> (alias for `!B3`). Exit codes are always computed against the unfiltered run,
> so a `--severity low` view won't accidentally hide a HIGH issue from a CI
> script reading `$?`. The legacy `--filter-rule` is a deprecated alias and
> emits a stderr warning.

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

### `checks run` — schemathesis-style depth checks (m-15)

`zond checks run` exercises a registered catalog of conformance and
security checks against a live API. Names mirror schemathesis V4 1-to-1
(`status_code_conformance`, `negative_data_rejection`, `ignored_auth`,
`use_after_free`, …). Use it after the spec/CRUD smoke when you want
boundary-value coverage and SARIF output for GitHub Code Scanning.

```bash
zond checks run --api myapi                                   # default: examples phase, mode=all
zond checks run --api myapi --check ignored_auth,use_after_free
zond checks run --api myapi --phase coverage --allow-x00      # ARV-6: deterministic boundary values
zond checks run --api myapi --mode positive                   # ARV-7: contract verification only
zond checks run --api myapi --mode negative                   # ARV-7: malicious-input probes only
zond checks run --api myapi --report sarif --output zond.sarif # ARV-5: GitHub Code Scanning
zond checks run --api myapi --workers auto                    # ARV-8: pool over operations (min(cpus, 8))
zond checks run --api myapi --workers 8 --rate-limit 50       # ARV-8: 8 workers, global 50 RPS budget
zond checks run --api myapi --ndjson | jq -c '.'              # ARV-10: stream events (one JSON per line)
zond checks list                                              # show the registered catalog
```

Flag cheat-sheet:

| Flag | What it does |
|------|--------------|
| `--mode positive\|negative\|all` | Drops checks/cases that don't belong to the requested mode. `positive` runs only contract-verification probes (status, schema, content-type, `positive_data_acceptance`); `negative` runs only malicious-input probes (`negative_data_rejection`, `ignored_auth`, `use_after_free`, missing-header / unsupported-method probes). Default `all`. |
| `--phase examples\|coverage\|all` | `examples` (default) emits one positive + one single-site negative per op; `coverage` enumerates deterministic boundary values per body field; `all` does both. |
| `--allow-x00` | Include the NUL byte (`\x00`) in string boundaries during the coverage phase. Off by default — some HTTP/JSON stacks panic on it. |
| `--check <ids…>` / `--exclude-check <ids…>` | Restrict the registered catalog. Combined with `--mode` (mode applied first). |
| `--report sarif --output <path>` | Emit SARIF v2.1.0 with stable `partialFingerprints` for `github/codeql-action/upload-sarif@v3`. |
| `--include <spec…>` / `--exclude <spec…>` | Unified operation filter (ARV-9). `<spec>` is `<selector>:<value>` — selectors `path:<regex>`, `method:<csv>`, `tag:<csv>`, `operation-id:<regex>`. Repeat the flag for OR semantics within a kind; combine includes + excludes for intersection. Same grammar in `zond generate`. |
| `--auth-header 'Name: value'` | Real-auth headers fed into stateful security checks. Auto-derived from `apis/<name>/.env.yaml` (`auth_token`, `api_key`) when `--api` is set. |
| `--bootstrap-cleanup-failed` | Skip stateful security checks with a warning when bootstrap-cleanup couldn't be confirmed (avoids FP on stale data). |
| `--workers <n\|auto>` | ARV-8: bounded async-pool concurrency at the *operation* level (cases inside one op stay sequential — CRUD chains rely on it). `auto` = `min(cpus, 8)`; numeric is clamped to `[1, 64]`. Default `1` = pre-ARV-8 sequential behaviour. |
| `--rate-limit <rps\|auto>` | ARV-8: global RPS budget across the worker pool. `auto` = adaptive limiter that paces from `RateLimit-*` response headers (RFC 9568). Combine with `--workers` so N workers never exceed `<rps>`. |
| `--ndjson` | ARV-10: stream events as NDJSON on stdout (one JSON object per line — types `check_start`, `check_result`, `finding`, `summary`). Schema published at `docs/json-schema/ndjson-events.schema.json`. Mutually exclusive with `--json` and `--report`. Stderr carries the human-readable summary line; stdout stays a clean stream for `\| jq` / ajv. |

Each finding carries an ARV-11 closed-enum `recommended_action` so an
agent can route on it without parsing free-form messages:

| `recommended_action` | Emitted by | What to do |
|---|---|---|
| `report_backend_bug` | `not_a_server_error`, `unsupported_method`, `positive_data_acceptance`, `use_after_free`, `ensure_resource_availability` | File a backend ticket — server returned 5xx, accepted bogus auth, or leaked deleted data. |
| `fix_spec` | `status_code_conformance`, `content_type_conformance`, `response_headers_conformance`, `response_schema_conformance` | Server's behaviour is reasonable; spec doesn't predict it. Update OpenAPI + `zond refresh-api`. |
| `tighten_validation` | `negative_data_rejection` | Server accepted invalid body — backend should reject earlier (400/422). |
| `add_required_header` | `missing_required_header` | Spec marks header `required: true`; server didn't enforce. Either enforce or relax spec. |
| `fix_auth_config` | `ignored_auth`, `network_error` (401/403) | Auth-related failure — verify `.env.yaml` (`auth_token`/`api_key`); never log values. |
| `fix_network_config` | `network_error` (other) | Transport-level error (timeout/DNS/refused). Verify `base_url`. |
| `wontfix_known_limitation` | (manual override) | Known accepted gap — don't retry, don't file a bug. |

Same enum is reused by `db diagnose` (TASK-294); the closed list lives
in `docs/json-schema/recommendedAction.schema.json`.

Exit code: `0` when no HIGH/CRITICAL findings, `1` otherwise. LOW/MEDIUM
findings are reported but don't gate CI by default — post-process the
JSON envelope (or SARIF) for stricter gating.

### `probe static` — bug-hunting static-input probes (validation + methods)

`probe static` runs the two static-input probe classes — **validation**
(catches 5xx on bad input) and **methods** (catches 5xx/2xx on undeclared
HTTP methods) — from a single command. Both read the spec on disk; no HTTP
calls are made. Defaults to running both classes; restrict via
`--include validation,methods` (or `--exclude`).

```bash
zond probe static openapi.json --output bugs/probes/
zond run bugs/probes/                     # any failure with 5xx response → bug
zond db diagnose <run-id>                 # group failures by root cause
```

#### validation class — bad-input fuzz

A correctly-implemented API returns **4xx** for any malformed client input —
never **5xx**. The validation class generates a deterministic battery of
negative-input probes from your OpenAPI spec; any 5xx response from the API
under test is a bug candidate.

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
`[400, 401, 403, 404, 405, 409, 415, 422, 429]` (ARV-34: 429 is a valid
server-side rejection — refusing-via-throttle still satisfies the contract);
a 5xx (or unexpected 2xx) is a test failure surfaced via the regular runner /
reporter / `zond db diagnose`.

**Real parent path-params (default).** For nested paths like
`/orgs/{organization_id_or_slug}/repos/{repo_id}/commits`, only the *attacked*
path-param is replaced with a synthetic value; non-attacked parents are
emitted as runtime placeholders (`{{organization_id_or_slug}}`) and resolved
from `.env.yaml` at run time. Without this, every probe would 404 on the
parent before the leaf validator ever fires, hiding nested-path 5xx bugs.
Pass `--use-synthetic-parents` (TASK-289; old name `--no-real-parents` is
deprecated) to keep the legacy fully-synthetic rendering (e.g. when you
have no real parent fixture).

**Cleanup of leaked resources.** A probe that *unexpectedly* returns 2xx on a
mutating endpoint (POST/PUT/PATCH) means the API silently accepted bad input
and created a resource. To keep probe runs idempotent in environments without
namespace isolation, the validation class pairs every mutating probe with a
follow-up `DELETE` step (`always: true`) that fires only if the probe captured
a resource id. When the API correctly rejects the probe with 4xx, the cleanup
step is skipped automatically. If the spec defines no DELETE counterpart for a
mutating endpoint, the generator prints a warning so you can clean up by hand.
Use `--no-cleanup` to opt out (e.g. for staging environments that dump-and-reset
between runs).

#### methods class — HTTP method completeness sweep

A correctly-implemented API returns **405 Method Not Allowed** (or 404) for
HTTP methods not declared on a path — never **5xx** (unhandled exception) and
never **2xx** (forgotten/shadowed route). The methods class generates one suite
per path that probes every method in `{GET, POST, PUT, PATCH, DELETE}` not
declared in the spec.

```bash
zond probe static openapi.json --include methods --output bugs/method-probes/
zond run bugs/method-probes/              # any 5xx or 2xx failure → bug
zond db diagnose <run-id>
```

Path placeholders are substituted with valid-shape sentinels (zero-UUID for
`format: uuid`, etc.) so the request reaches the routing layer rather than
being rejected purely on path syntax. Body-bearing methods carry a minimal
`{}` JSON body. Each probe expects status in `[401, 403, 404, 405]`; anything
else is a test failure. Probes are deterministic — same spec → same suites —
so generated YAML can be committed as a regression test.

### `probe mass-assignment` — privilege-escalation hunt

Mass assignment is the class where an API silently accepts client-supplied
fields that should be server-controlled — `is_admin`, `role`, `account_id`,
`owner_id` — and either *applies* them (privilege escalation) or *ignores*
them (silent acceptance, latent risk). Unlike the other probes,
`probe mass-assignment` runs **live** against a real API: the only way to
distinguish "applied" from "ignored" is to read back the resource via a
follow-up GET.

```bash
zond probe mass-assignment openapi.json \
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

**Path-param auto-discovery (TASK-92).** When env doesn't supply a value for
a path placeholder (`{domain_id}`, `{webhook_id}`, …), the probe tries to
find a sibling list endpoint in the spec — `GET /domains` for
`/domains/{domain_id}` — call it once per run, and pull the first item's id
(`data[0].id`, `items[0].id`, top-level `[0].id`). The discovered value is
cached per `GET <listPath>` so all endpoints sharing the same parent
resource pay only one extra HTTP call. Nested collections
(`/orgs/{org_id}/projects/{project_id}`) are resolved recursively.
If the list is empty / 4xx / not in the spec, the endpoint still goes to
SKIPPED but the digest spells out *why*
(e.g. `auto-discover failed (GET /domains returned empty list)`) instead of
the generic missing-env message. Use `--no-discover` to disable when GET
side-effects are unwanted.

**Isolated mode (`probe security --isolated`, TASK-264).** Live probes
mutate state — by default, a `PUT /teams/{team_slug}` attack can scribble
over the team you just bootstrapped via `.env.yaml`, breaking the next
`zond run`. The flag lives on `probe security`: pass `--isolated` and the
probe refuses to attack PUT/PATCH endpoints whose path-params resolve from
`.env.yaml` (skipped with `skipReason: "--isolated mode protects seeded
fixtures"`). POST endpoints still run — they create their own throwaway
resource and the existing DELETE-counterpart + orphan-tracker (TASK-278)
clean it up.

```bash
zond probe security --api sentry --isolated
# PUT /teams/{team_slug} → SKIPPED: --isolated mode protects seeded fixtures
# POST /teams           → probed, then DELETE-cleaned up
```

The trade-off is lower coverage — the seeded-fixture endpoints get a
SKIPPED entry instead of HIGH/LOW findings — but `tests-run → probes-run
→ tests-run` round-trips on the same fixtures stop 404'ing. (For mass-
assignment, isolation is achieved by giving the probe scratch fixtures via
`prepare-fixtures --cascade --seed` instead of seeded ones.)

#### Stale fixture re-validation (`--verify` / `--refresh`)

After `probe security` / `probe mass-assignment` runs, an FK fixture in
`.env.yaml` may point at a resource that has been deleted (the probe created
+ deleted it as part of its cycle, or you cleaned it manually). The next
`zond run` then 404s on every step that uses the stale id. Use
`prepare-fixtures --verify` to re-validate without writing:

```bash
zond prepare-fixtures --api sentry --verify
# Verify summary: 12 live, 1 stale, 0 unknown.
# WARN: 1 stale fixture(s) detected. Re-run with --refresh to drop and re-resolve them.

zond prepare-fixtures --api sentry --refresh   # = --verify --apply
```

Classification rules:

- 2xx on read-by-id → `live` (kept as-is)
- 404 / 410 → `stale` — `--refresh` drops it from `.env.yaml` and re-runs the
  normal list-endpoint discovery
- 5xx → `unknown` (treated as flake; the fixture is **not** dropped)

Fixtures whose owner resource has no `read` endpoint in
`.api-resources.yaml` are reported as `verify-no-read` and skipped — verify
needs a GET-by-id to check.

---

### `coverage` — pass-coverage vs hit-coverage

`zond coverage` reports two metrics on every run (TASK-270):

- **pass-coverage** — endpoint had at least one passing 2xx response.
  This is the strict metric and what `--fail-on-coverage` gates against.
- **hit-coverage** — endpoint received any response at all (5xx, 4xx,
  network error, assertion failure). Loose metric, useful for breadth
  audits — "did we even reach this corner?"

```
$ zond coverage --api sentry --union session
Pass-coverage (passing 2xx): 67/219 endpoints (31%) — union session of 4 runs (#42, #43, #44, #45)
Hit-coverage  (any response): 200/219 endpoints (91%)
```

The single-run output and `--union` output now use the same labels, so the
old «91% in union, 31% standalone, both called coverage» trap is gone.

### `coverage` — three-bucket JSON breakdown

`zond coverage --api <name> --json` returns the same split that the text
reporter shows, in three explicit arrays so downstream tooling doesn't have
to re-derive it from the matrix:

```jsonc
{
  "totals":   { "all": 219, "covered2xx": 67, "coveredButNon2xx": 152, "unhit": 0 },
  "pass_coverage": { "covered": 67,  "total": 219, "ratio": 0.3059 },
  "hit_coverage":  { "covered": 219, "total": 219, "ratio": 1.0 },
  "covered2xxEndpoints":      [{ "endpoint": "GET /a",  "method": "GET",  "path": "/a",  "lastStatus": 200 }, …],
  "coveredButNon2xxEndpoints":[{ "endpoint": "PUT /b",  "method": "PUT",  "path": "/b",  "lastStatus": 502 }, …],
  "unhitEndpoints":           [{ "endpoint": "GET /c",  "method": "GET",  "path": "/c",  "lastStatus": null }, …]
}
```

Buckets:

- **covered2xx** — at least one stored result on the endpoint was a
  passing 2xx (matches `✅ N covered (passing 2xx)` in the text view).
- **coveredButNon2xx** — endpoint was hit but never returned a 2xx pass:
  5xx, 4xx, or assertion-failed steps.
- **unhit** — no stored results at all on this endpoint.

`covered`, `partial`, `uncovered`, and the `*Endpoints` string arrays are
kept as **deprecated aliases** for backward compatibility — new consumers
should read `totals.*` and the three bucket arrays.

---

### `report export` — single-file shareable HTML run reports

After a run lives in SQLite (`zond.db`), `zond report export <run-id>`
materialises it as a self-contained HTML file you can drop into a Slack
thread, attach to a GitHub issue, or open offline weeks later.

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

### `report bundle` — case-study markdown drafts for all failures

The standalone `report case-study <failure-id>` was removed (TASK-287)
in favour of `zond report bundle`, which renders the same per-failure
markdown drafts (one per failure) plus the HTML report and `db diagnose`
JSON for any range of runs:

```bash
zond report bundle <run-id> --include case-study           # only the markdown drafts
zond report bundle 135..142 -o triage/sweep/               # full sweep, all artefacts
zond report bundle --session <id> -o triage/session/       # by session_id
```

The case-study renderer (`renderCaseStudy`) still fills in the same
template from run/results/spec data: TL;DR by `failure_class`, frozen
spec excerpt, repro `curl`, response body, expanded assertion diffs,
and `<TODO: ...>` placeholders for anything zond couldn't determine.

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

### Body formats

| Field | Content-Type | Use for |
|---|---|---|
| `json: <value>` | `application/json` (auto) | Default JSON bodies |
| `form: { k: v }` | `application/x-www-form-urlencoded` (auto) | Form-encoded params |
| `multipart: { ... }` | `multipart/form-data; boundary=...` (auto) | File uploads + mixed text/file fields |

`raw:` is **not** a supported field — zond does not parse arbitrary raw bodies. For file uploads, use `multipart:`:

```yaml
- name: Upload release artifact
  POST: /api/0/organizations/{{org}}/releases/{{ver}}/files/
  multipart:
    name: "bundle.js"                    # text part
    file:                                # file part
      file: ./fixtures/bundle.js         # path relative to suite YAML
      filename: bundle.js                # optional, defaults to basename
      content_type: application/javascript  # optional, defaults to application/octet-stream
  expect:
    status: 201
```

The `Content-Type` header (with boundary) is generated by the runner — do **not** set it manually; doing so will mismatch the actual boundary and the server will 400.

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

Полный набор правил (источник истины — `src/core/runner/assertions.ts`):

| Rule | Example | Semantics |
|---|---|---|
| `equals` | `{ equals: "Dogs" }` | deep-equality (loose number↔numeric-string at top level) |
| `not_equals` | `{ not_equals: null }` | отрицание `equals` |
| `exists` | `{ exists: true }` | ключ присутствует в ответе (включая `null`) |
| `type` | `{ type: "string" }` | `string \| integer \| number \| boolean \| array \| object \| null` |
| `contains` | `{ contains: "@" }` | substring (только для string) |
| `not_contains` | `{ not_contains: "error" }` | string не содержит подстроку |
| `matches` | `{ matches: "^[A-Z]" }` | regex (string only) |
| `gt` / `gte` / `lt` / `lte` | `{ gt: 0 }` | сравнение чисел |
| `length` | `{ length: 3 }` | точная длина (array или string) |
| `length_gt` / `length_gte` / `length_lt` / `length_lte` | `{ length_gt: 0 }` | сравнения длины |
| `each` | `{ each: { id: { type: "string" } } }` | каждый элемент массива удовлетворяет sub-rules |
| `contains_item` | `{ contains_item: { status: { equals: "active" } } }` | хотя бы один элемент массива удовлетворяет sub-rules |
| `set_equals` | `{ set_equals: ["a", "b", "c"] }` | массивы как множества (порядок и дубликаты игнорируются) |
| `capture` | `{ capture: created_id }` | сохранить значение в переменную для следующих шагов |

**Status:** `status: 200` или `status: [200, 204]` (массив = «один из»).

**Nested paths:** `category.name: { equals: "Dogs" }`. Точка — разделитель.
Корневой body: `_body: { type: "array" }`.

**Field name conflicts:** если в ответе есть поле буквально с именем `type`,
`equals`, `length` и т.п. — используй кавычки в dotted-path, чтобы парсер
не принял за rule:

```yaml
expect:
  body:
    "user.type": { equals: "admin" }   # asserts user.type === "admin"
    "data.length": { gt: 0 }           # asserts data.length > 0
```

**Combinable rules.** Несколько правил на один путь работают как AND:
`{ exists: true, not_equals: null, type: "string" }`.

**Exists semantics.** `exists: true` означает «ключ присутствует», включая
случай когда значение `null`. Чтобы потребовать «present и не null»:
`{ exists: true, not_equals: null }` или `{ type: "string" }`.

**Capture для chained suites.** Captures видны только внутри одного suite.
Для передачи между suites используй `setup: true` сьют (его captures вливаются
в env regular suites).

#### Полный пример

```yaml
- name: list users — shape contract + capture id
  GET: /users
  expect:
    status: [200, 304]
    body:
      object:    { equals: "list" }
      data:      { type: "array", length_gt: 0 }
      data[0].id:
        exists: true
        not_equals: null
        type: "string"
        capture: first_user_id
      data[0].email: { matches: "^[^@]+@[^@]+\\..+$" }
      data:
        each:
          id:    { type: "string" }
          email: { type: "string" }
      meta.has_more: { type: "boolean" }
```

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
- **`.env.yaml`:** add a top-level `rateLimit: <N>` field (per-API). Picked up when no CLI flag is given.
- **`zond.config.yml` (TASK-301):** `defaults.rate_limit` sets a workspace-wide default. Resolution chain: CLI > `.env.yaml` > workspace defaults > undefined.
- **Auto retry on 429:** the runner respects the `Retry-After` header (seconds or HTTP-date). If the header is missing, it falls back to capped exponential backoff (base = `retry_delay`, cap = 30s). Up to 5 attempts per request, then the 429 is reported as the final response.
- **Adaptive throttling from response headers (`--rate-limit auto`):** zond reads the standard `RateLimit-Remaining` / `RateLimit-Reset` headers (RFC 9568, formerly `draft-ietf-httpapi-ratelimit-headers`) plus the GitHub/Stripe-style `X-RateLimit-*` aliases on every response. Two complementary mechanisms keep parallel suites from blowing through small windows:
  - **Window-aware spacing (TASK-88):** when the response carries `RateLimit-Policy: N;w=W` (e.g. Resend's `5;w=1`), the limiter learns a per-request interval of `(W/N) * 1000 + 50ms` safety. Subsequent acquires — even from suites running in parallel — are paced one-by-one at that interval, so a burst of 10 simultaneous requests fans out to ten ~200ms steps instead of overshooting in the first 50ms. The strictest policy wins when several are advertised. `IntervalRateLimiter` (static `--rate-limit N`) tightens too if the server's policy is more restrictive than the user-supplied cap; it never loosens below the cap.
  - **Reset-window pause:** when `remaining` drops to ≤2, subsequent requests are pinned to wait until the API's `reset` window expires.
  
  `--rate-limit auto` starts with no static cap and lets the API's headers do the throttling — useful for `zond probe static` and `zond probe mass-assignment` runs against production APIs where the right cap isn't known up front.

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

### Learning from drifts (`--learn`)

`zond run --learn` flags «passing test, wrong status» cases — the spec says
`201`, the server returns `200`, the body still matches the OpenAPI schema, so
the failure is purely a status-code mismatch. By default `--learn` only prints
the plan; nothing is written to disk.

```bash
zond run --api sentry --learn
# Drift detected (3 cases):
#   POST /user-feedback/   spec=201  observed=200  body-schema=ok  → suggest: update test, or add to drifts
#   POST /sessions/        spec=201  observed=200  body-schema=ok  → suggest: update test
#   POST /scim/v2/Users/   spec=201  observed=200  body-schema=ok  → suggest: update test
```

Apply the plan in one of two ways:

```bash
# Rewrite expect.status in the YAML — minimal, line-based edit, preserves comments.
zond run --api sentry --learn --learn-apply --learn-target=test

# Record under apis/<name>/tolerated-drifts.yaml for human review (no test mutation).
zond run --api sentry --learn --learn-apply --learn-target=drifts
```

`--learn` implies `--validate-schema`: a status mismatch is only treated as
drift when the body still validates against the OpenAPI response schema. If
the body diverges from the schema, the case is **not** proposed — that's a
real contract bug that should not be silently masked.

> **Do not run `--learn-apply` against an untrusted target.** A hostile or
> misconfigured server can return any 2xx + a schema-shaped body, which would
> teach `zond` to accept its drift permanently. Reserve the apply-flow for
> servers whose contract you trust.

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

The workspace root is used as the default location for `zond.db`, the `apis/<name>/` directory created by `zond add api`, and the `.zond/current-api` file written by `zond use` (TASK-290; was `.zond-current`). Explicit `--db` and `--dir` flags always win over walk-up.

### Workspace defaults (TASK-301)

`zond.config.yml` carries optional defaults that apply to every command in
the workspace. Per-command flags always win; per-API overrides live in
`apis/<name>/.env.yaml` as `rateLimit:` / `timeoutMs:`.

```yaml
defaults:
  timeout_ms: 30000   # cleanup / prepare-fixtures / probe / request
  rate_limit: 5       # `zond run` (number rps, or "auto" for adaptive)
```

Resolution (highest wins): **CLI flag → `.env.yaml` meta → `defaults.*` → built-in fallback** (30000 ms / no rate limit).

### Per-API artifacts (`apis/<name>/`)

`zond add api` and `zond refresh-api` produce a self-contained set of files
agents and tools read instead of the raw spec — keeps token cost bounded
and makes API drift git-visible.

| File | Role | Read by |
|------|------|---------|
| `spec.json` | Dereferenced OpenAPI snapshot — canonical machine source. | `generate`, `probe-*`, `--validate-schema`, anything that needs full schemas. |
| `.api-catalog.yaml` | Compressed endpoint index (method/path/params/compressed schemas). | Skill prose, `describe`. **Cheap to read.** |
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

**Canonical `--json` shape (TASK-145).** Everything diagnostic lives under
`.data` — there is no `.diagnostics` wrapper. The schema:

```
.data.api                       string
.data.spec.{path,exists,sha}    OpenAPI snapshot info
.data.fixtures.required[]       FixtureMetaRow (each has `set: boolean`)
.data.fixtures.optional[]       same shape
.data.fixtures.extraInEnv[]     keys present in .env.yaml only
.data.staleArtifacts[]          { file, expected, actual, fresh }
.data.blockedRequired           number of unset required fixtures
.data.warnings[]                advisory strings
```

Two pipe-friendly conveniences avoid an extra `jq`:

- `zond doctor --missing-only` — drop rows already healthy. Required
  fixtures with values, fresh artifacts, optional fixtures and
  `extraInEnv` disappear from both text and JSON output; `warnings` stay.
- `zond doctor --query <dotpath>` — resolve `fixtures.required`,
  `staleArtifacts`, `spec.sha`, etc., and emit just that subtree as raw
  JSON to stdout (no envelope). Unknown paths fail with exit 2.

### `.env.yaml` interpolation and secrets

`.env.yaml` is the API-level fixture file. Two indirection mechanisms keep
it committable while the actual secret values stay out of git.

**`${VAR}` / `${VAR:-default}` (TASK-169):** values are pulled from the
shell environment when the file is loaded.

```yaml
# apis/sentry/.env.yaml (committable)
base_url:   "${SENTRY_BASE_URL:-https://us.sentry.io}"
auth_token: "${SENTRY_AUTH_TOKEN}"
```

- An unresolved `${VAR}` without a `:-default` fails fast with the file
  path and key.
- `\${LITERAL}` keeps the literal `${LITERAL}` (the backslash is stripped).
- One level of resolution only; values are not re-scanned for further `${...}`.
- Variable names that look like secrets (`TOKEN`, `SECRET`, `PASSWORD`,
  `API_KEY`, `DSN`) get a one-line warning suggesting `@secret:` instead.

**`@secret:<name>` (TASK-170):** values come from a sibling `.secrets.yaml`
which is gitignored and auto-populated by `zond add api`.

```yaml
# apis/sentry/.secrets.yaml (NEVER committed)
auth_token: "sntryu_..."

# apis/sentry/.env.yaml
auth_token: "@secret:auth_token"
```

Loading `.secrets.yaml` registers every value with the `SecretRegistry`
(see below), so anything echoed in a request URL, response body, header,
digest, or report is replaced with `<redacted:<name>>` before it lands on
disk. A missing `@secret:<name>` reference fails loud — never silent.

### Auto-redaction of secret values (m-10)

`zond` keeps a runtime `SecretRegistry` of every value it knows is
sensitive (currently populated from `.env.yaml` keys; later from
`@secret:` references and `.secrets.yaml`). Before any value is
persisted — DB rows, HTML / JSON / JUnit exports, case-study Markdown,
digest files, `--verbose` stdout — it goes through a sanitizer pass that
replaces each registered value with the marker:

    <redacted:<var-name>>

For example, `Authorization: Bearer abc123…xyz` becomes
`Authorization: <redacted:auth_token>`. The marker carries the variable
*name* (not the value), so a teammate opening a redacted artifact knows
which env var to pull locally.

Pass `--no-redact` (global flag) to disable the pass for local debugging.
The flag never leaves your shell — it does **not** survive into shared
artifacts.

Rules:
- Exact-match only — no heuristics. A value is redacted only if it was
  explicitly registered.
- Values shorter than 8 characters are silently ignored, so `id: 1`
  cannot accidentally turn every "1" in a report into `<redacted>`.
- Longer registered values redact before shorter ones (specificity).

Redaction points:

| Path                                  | When                | Source            |
|---------------------------------------|---------------------|-------------------|
| `results` table INSERT                | every `zond run`    | TASK-167          |
| JSON reporter (`--report json`)       | live runner         | reporter wrap     |
| JUnit reporter (`--report junit`)     | live runner         | reporter wrap     |
| `report export` (HTML)                | export from DB      | defensive wrap    |
| `report bundle` (case-study Markdown) | export from DB      | defensive wrap    |
| `probe mass-assignment` digest        | live probe run      | digest wrap       |
| `probe security` digest               | live probe run      | digest wrap       |

The `results`-table redaction (TASK-167) is the main barrier — anything
read back from the DB is already clean. The exporter wraps are defensive
so a future code path that synthesises new strings (renderProvenance,
coverage hints, etc.) cannot regress the guarantee.

### `.env.yaml` is API-level, never duplicated under `tests/`

Runtime variables live in **one** file per API: `apis/<name>/.env.yaml`.
`zond generate` will create it the first time (when missing) and never
overwrites it on subsequent runs — values you fill in (`auth_token`, FK
ids) survive every regeneration. There is no `tests/.env.yaml`; if you
see one from an older zond, delete it (the API-level file is the source
of truth).

Likewise, `.api-catalog.yaml` lives only at the API root
(`apis/<name>/.api-catalog.yaml`). `zond generate` no longer emits a
duplicate inside the test output directory.

### `zond clean` — remove auto-generated files

`zond` tracks every file it writes (catalog/resources/fixtures, `.env.yaml`,
generated tests, probe-suites, `spec.json`) in `.zond/manifest.json` together
with its sha256 at write-time. `zond clean` consults that manifest to remove
only auto-generated content and never user edits.

```bash
zond clean --api petstore             # dry-run: list what would be deleted for one API
zond clean --probes                   # dry-run: only probe-suite YAMLs
zond clean --all                      # dry-run: every tracked auto-generated file
zond clean --api petstore --force     # actually delete
```

- Default is dry-run; `--force` is required to delete.
- A file whose sha256 no longer matches the manifest is treated as
  manually-edited and is **skipped** (printed as a warning).
- `.env.yaml`, `.gitignore`, and any user-authored YAML stay untouched
  because they are never recorded in the manifest.
- After deletion the surrounding empty directories are removed too, but
  only if they hold nothing else.

### Orphan resources & `zond cleanup --orphans`

Live security/mass-assignment probes create resources to attack and try to
DELETE them on the way out. When that DELETE fails (5xx, 401/403, network
flake — anything other than 404), the resource leaks into your real
workspace. Each probe run snapshots every cleanup attempt to
`~/.zond/orphans/<api>/<run-id>.jsonl`, so you don't have to find the
remnants by hand.

```bash
# Probe summary now lists each orphan with its id and DELETE path:
#   POST /teams/ (id=zond-probe-x7q3); DELETE /teams/zond-probe-x7q3/ → 500
#   Run `zond cleanup --orphans --api sentry` to retry.

zond cleanup --orphans --api sentry --dry-run   # show the plan
zond cleanup --orphans --api sentry              # retry DELETEs
zond cleanup --orphans --run 1730312121234       # restrict to one probe run
```

Behaviour:

- `404` and `2xx` on retry → success; the record is superseded (an append-
  only `removed: true` line) so the next run won't re-attempt it.
- `5xx` / `4xx` (other than 404) / network errors → still alive; exits 1
  so a CI gate can react.
- The store is append-only. Crashes mid-cleanup leave the partial state
  recoverable; nothing is rewritten in place.
- Override the directory with `ZOND_ORPHANS_DIR` (used by the test
  suite); default is `~/.zond/orphans/`.

### Sessions — group multiple runs into one campaign

A "session" stitches multiple `zond run` invocations under one `session_id` so `db runs` and `coverage --union session` see them as a single campaign. Use it when running a typical sweep — `smoke + probe static + mass-assignment` — and you want them grouped instead of N scattered runs.

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

If none of those is set, the run is "ad-hoc" and stays standalone — `coverage --union session` skips it.

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
  "ok": true,                            // false on errors[].length > 0
  "command": "db diagnose",
  "data": { /* command-specific payload */ },
  "warnings": [ /* string[], non-fatal */ ],
  "errors":   [
    // TASK-296: structured ZondError, not bare strings
    { "code": "MISSING_FIXTURE", "message": "…", "details": { /* optional */ } }
  ]
}
```

Holds for `db collections|runs|run|diagnose|compare`, `check tests|spec`,
`coverage`, `generate`, `probe <class>`, `request`, `init`, `add api`,
`refresh-api`, `doctor`, `describe`, `use`, `catalog`, `cleanup`,
`report bundle`, `prepare-fixtures`. The `data` payload shape varies by
command (e.g. `db run`'s `data` is `{ run, results }`); the envelope itself
does not. Error codes follow the `ZondErrorCode` enum (see
`docs/json-schema/error.schema.json`).

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

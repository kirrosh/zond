# Changelog

All notable changes to this project will be documented in this file.

## [0.22.0] — 2026-04-29

### Round-2 papercuts (TASK-68 → TASK-86)

- **TASK-68: `zond run --safe` (no path) no longer crashes with `paths[0] must be of type string, got boolean`.**
  Commander's auto-negation `--no-db` defaulted `opts.db` to `true`; the boolean leaked into `path.resolve()` via a lazy
  cast. dbPath is now normalised the same way as elsewhere; the no-path / no-`.zond-current` error is explicit and
  mentions both `zond use <api>` and `--api`.

- **TASK-69: `zond db diagnose` no longer hides 5xx failures behind cluster summaries.**
  `groupFailures` previously kept only the first item per group plus 2 examples — for `assertion_failed` clusters that's
  fine, but for `api_error` (5xx) it silently dropped backend-bug evidence. 5xx groups are now always preserved in full
  in `data.failures` and `examples`; assertion/network groups continue to fold.

- **TASK-71: YAML parse errors now report `file:line:col` plus a snippet with a column pointer.**
  `Bun.YAML.parse` exposes JS-stack coordinates, not YAML positions — on failure we re-parse with `yaml` (eemeli) just
  for diagnostics and surface `linePos` in the error. Pre-checks for embedded NUL bytes and points at the
  `{{$nullByte}}` generator. Adds `yaml@2.8.3` dependency.

- **TASK-77: suite-level `parameterize: { key: [val, …] }` cross-product.**
  Replaces copy-pasting one test across N endpoints. Multiple keys produce the cross-product. Captures and
  tainted/missing-capture state are reset between iterations so values from one binding never leak into the next; step
  names are interpolated through `{{var}}` so reporters and `db diagnose` can tell iterations apart.

- **TASK-79: `probe-validation` now pairs every mutating probe with a cleanup-DELETE.**
  When a probe accidentally returns 2xx (the bug class probe-validation hunts for), the new follow-up `DELETE` step
  (`always: true`) consumes a `leaked_id_<i>` capture and removes the resource. When the probe correctly gets 4xx, no id
  is captured and the cleanup is skipped automatically. If the spec defines no DELETE counterpart, the generator emits a
  warning instead. New `--no-cleanup` flag opts out for namespace-isolated test envs.

- **TASK-81: `--rate-limit auto` reads `RateLimit-*` response headers and adapts.**
  Implements RFC `draft-ietf-httpapi-ratelimit-headers` plus the GitHub/Stripe `X-RateLimit-*` aliases. When `remaining`
  drops to ≤5, subsequent requests pause until reset (relative-seconds vs Unix-timestamp distinguished by magnitude).
  Static `--rate-limit N` benefits from the same hook — the cap is a floor, headers can push pauses out further.

- **TASK-86: `zond generate` honours `format` even when `type` is absent or array (OpenAPI 3.1 nullable).**
  `format: email` on a schema with no `type` (or `type: ["string", "null"]`) used to fall through to the default branch
  and produce `{{$randomString}}`. Format-to-placeholder mapping is now dispatched before the type switch.

### Breaking changes

- **MCP layer removed** (see [decision-2](backlog/decisions/decision-2%20-%20Drop-MCP-server-—-keep-CLI-agent-skills-as-the-only-integration-surface.md)) —
  CLI is the only integration surface; agent skills in `skills/*/SKILL.md`
  are read directly. Specifically:
  - `zond mcp start` removed.
  - `zond install --claude/--cursor` removed (was only used to write
    `~/.claude/mcp.json` / `~/.cursor/mcp.json` for the MCP transport).
  - `--integration mcp` flag of `zond init` removed; default integration
    is now `cli` (writes a self-contained `AGENTS.md` with full workflow
    inline). `--integration skip` still works.
  - `@modelcontextprotocol/sdk` runtime dependency dropped.
  - `src/mcp/` deleted entirely (~817 LOC).
  - `src/cli/commands/install.ts` and `src/cli/commands/mcp.ts` deleted.
  - `tests/integration/mcp*.test.ts` removed.
  - All MCP references purged from README, ZOND.md, docs/, skills/,
    AGENTS.md, CLAUDE.md.
  - Migration: existing `~/.claude/mcp.json` / `~/.cursor/mcp.json` keep
    referencing a `zond` server that no longer responds; remove the
    `zond` entry from your client config. New flow — see updated
    `AGENTS.md`: agents call `zond` commands directly.

- **`zond migrate` removed** — the migration system was added and then removed in the same branch.
  Format changes in zond are backward-compatible or require a clean `zond generate`.

---

### Features

#### Generator

- **Sanity suite** (`sanity.yaml`) — `zond generate` now produces a 1-2 step sanity file as the
  first output: an auth step (if the API has auth) + a connectivity probe (healthcheck or first
  simple GET). Run with `--tag sanity` before the full suite to catch `base_url`/auth issues early.
  Skill workflow updated with mandatory Step 3.25.

- **Multipart bodies** — endpoints with `requestBody: multipart/form-data` now generate `multipart:`
  blocks instead of empty `json:`. Binary (`format: binary` / `format: byte`) fields become
  `{ file: ./fixtures/<field>.bin, content_type: application/octet-stream }`.

- **Reset endpoint isolation** — `reset`, `flush`, `purge`, `truncate`, `wipe`, `clear-data`,
  `factory-reset` paths now get tags `[system, reset]` instead of `[smoke, unsafe]`, preventing
  them from running during smoke passes and accidentally wiping server state.

- **Logout exclusion from setup suites** — `logout`, `signout`, `invalidate`, `revoke` endpoints
  are no longer included in `setup: true` auth suites. Including them would invalidate the captured
  token for all subsequent suites.

- **Seed values in smoke path params** — GET smoke steps with path parameters now use concrete seed
  values (from spec `example` field, or `1` for id-like params) instead of unresolved `{{id}}`
  placeholders that cause failures at runtime.

- **Bounded integer generation** — `integer` fields with a `maximum` constraint now generate a
  concrete in-range value instead of `{{$randomInt}}`, which could exceed server-side validation
  limits.

- **ETag auto-injection** — when an endpoint has `412` in its responses or an `If-Match` header
  parameter, the CRUD generator automatically inserts a GET capture step before PUT/PATCH/DELETE
  to capture the ETag, and adds the `If-Match: "{{resource_etag}}"` header to the mutation step.

#### Executor

- **`set:` on HTTP steps** — `set:` directives on regular HTTP steps are now evaluated before the
  request, pinning generators (e.g., `$uuid`) once so the same value can flow into the request body
  and be reused in subsequent steps.

#### Setup suites

- **Auth token auto-sharing** — `setup: true` flag on a suite causes it to run before all other
  suites (sequentially). Its captured variables (e.g., `auth_token`) are merged into the environment
  of every subsequent suite automatically. Generated auth suites now include `setup: true`.

#### Export

- **`zond export postman`** — converts YAML test suites to Postman Collection v2.1 JSON.
  - Full assertion mapping: `status`, `body`, `headers`, `duration` → `pm.test()`/`pm.expect()`
  - Captures → `pm.environment.set()` for cross-request variable sharing
  - `set:` steps → `pm.environment.set()` pre-request scripts on the next HTTP step
  - `skip_if` → `pm.execution.setNextRequest()` pre-request event
  - Optional `--env` flag exports `.env.yaml` as a Postman Environment JSON
  - `each`, `contains_item`, `set_equals` assertions fully translated
  - `type: integer` → `Number.isInteger()` (not `.be.a('number')`)
  - Setup suites sorted first to mirror zond runner behaviour
  - Newman CLI hints embedded in collection description for non-default configs

#### Sync

- **`zond sync`** — incremental test update command. Compares the current spec against the hash
  stored in `.zond-meta.json`, generates test files only for new endpoints, never overwrites
  existing files. Reports removed endpoints as warnings. Updates `collections.openapi_spec` in
  SQLite automatically.

- **`.zond-meta.json`** — metadata file written by `zond generate` and `zond sync`. Stores
  spec URL, SHA-256 hash, and per-file metadata for drift detection.

#### Diagnostics

- **`recommended_action`** field on every failure in `zond db diagnose --json`:
  `report_backend_bug` / `fix_auth_config` / `fix_test_logic` / `fix_network_config`.

- **`agent_directive`** top-level field — when `api_error` count > 0, tells the agent explicitly
  to stop iterating and report the server bug instead of modifying test expectations.

- **`cascade_skips`** field — groups skipped tests by the missing capture variable, making
  "5 tests skipped because `createCase` step failed" visible instead of a flat skip list.

- **`auth_hint`** — surfaces when ≥30% of tests fail with 401/403, and now mentions
  `setup: true` as the recommended fix.

- **Soft delete hint** — when a GET returns `200` with a `status`/`state`/`deleted` field instead
  of the expected `404` (after a DELETE), the diagnostic now surfaces a "likely soft delete" hint
  with a concrete suggestion to assert the status field value.

- **5xx response highlighting** — console reporter now flags failed steps with HTTP 5xx
  responses with a yellow `[5xx <status>]` tag, and the suite/grand-total lines show a
  separate `<N> 5xx` count. The `--json` envelope adds `http_status` and `is_5xx` per
  failure plus a top-level `summary.fiveXx` count, so probe-validation runs surface
  bug candidates at a glance.

- **`--report-out <file>`** on `zond run` — writes the JSON or JUnit report directly to a
  file (with `mkdir -p`) instead of to stdout, logging `zond: <FORMAT> report written to
  <path>` on stderr. Decouples the report from any wrapper banner that prefixes stdout
  (notably `bun run zond -- run …`), so downstream JSON parsers don't break.

#### Bug-hunting probes

- **`zond probe-validation <spec>`** — generates deterministic negative-input probe
  suites that catch the 5xx-on-bad-input class of bugs (the contract: any malformed
  client input must produce a 4xx, never a 5xx). Per endpoint emits probes for: invalid
  path UUIDs, empty body, missing required fields, type confusion, invalid format
  (`email`/`uri`/`date-time`/`uuid`), boundary strings (empty, 10000-char,
  unicode/emoji/RTL), invalid enum values and array-of-string-enum (catches the
  webhooks-events bug shape). `--max-per-endpoint` caps probe count, `--tag` filters
  endpoints. Generated suites embed suite-level `base_url`/auth and are runnable as-is.

- **`zond probe-methods <spec>`** — HTTP method completeness sweep. For every path,
  emits one probe per `{GET, POST, PUT, PATCH, DELETE}` method that is *not* declared
  in the spec, expecting a 4xx (`401/403/404/405`). Path placeholders are substituted
  with valid-shape sentinels so the request reaches the router. Catches "PUT on a
  POST-only endpoint returns 500" bugs.

- **`probe-validation --list-tags`** — lists all tags from the OpenAPI spec without
  generating anything. `--tag X` is now case-insensitive and trims whitespace; matching
  zero endpoints exits 2 with a clear error and the available-tags list.

#### Runner

- **`zond run --sequential`** — opt-out of parallel suite execution. Forces
  sequential runs of all suites (useful when a setup token must propagate or when
  rate-limits make parallel suites trigger 429s).

- **Auto-load `./.env.yaml`** — `zond run` now also tries `$PWD/.env.yaml` when
  `--env` is not given and neither searchDir nor its parent has one. Logs
  `zond: using ./.env.yaml (cwd fallback)` on stderr. Unblocks running absolute test
  paths from a collection cwd.

#### Reporter / DB

- **Cascade-skip reason inline** — console reporter now prints
  `(skipped: <error>)` instead of just `(skipped)`, surfacing the underlying
  capture/auth failure on the very same line.

- **Run classification** — `zond db runs` now classifies a run with `total > 0`,
  `passed == 0`, and many errors as **FAIL** instead of PASS. Prevents a probe run
  with all 5xx responses from looking green in the runs listing.

---

### Fixes

#### Parser / runtime

- **`expect.headers` now accepts `AssertionRule`** — headers can use `capture:`, `equals:`,
  `type:`, etc. (previously only plain string equality). Enables ETag and other header captures.

- **`filePath` normalized to absolute** — `yaml-parser.ts` now stores absolute paths so
  `multipart: file:` paths resolve correctly regardless of CWD at execution time.

- **`multipart:` bodies now reach the HTTP client** — `formData` field added to `HttpRequest`;
  `http-client.ts` sends `formData` when present (previously only `body` was sent, so multipart
  requests were sent empty).

- **`multipart:` variable substitution** — `substituteStep` now processes `multipart:` field
  values, so `{{variables}}` inside multipart blocks are interpolated correctly.

- **Safe mode preserves auth endpoints** — `execute-run.ts` safe mode now keeps
  `login`/`token`/`oauth` endpoints consistent with `run.ts` behaviour.

#### Generator data quality

- **Nested object serialization** — `serializeValue` in `serializer.ts` now recurses into objects
  instead of calling `String(val)`, fixing `[object Object]` in array item bodies.

- **`format: date`** returns `"2025-01-01"` (date-only), not a full datetime string.

- **`format: uuid`** overrides type — `integer` fields with `format: uuid` now correctly get
  `{{$uuid}}` instead of `{{$randomInt}}`.

#### Skill / documentation

- **SKILL.md NEVER rules** — added explicit stop rules for: in-memory auth tokens, ETag, soft
  delete, rate limits, setup suite design, `--tag` without setup tag.

- **SKILL.md generator smart behaviors** — documents all generator improvements so agents know
  what to expect from generated output.

---

### Removed

- `src/mcp/` and all MCP tooling (~1900 lines deleted)
- `zond mcp` CLI command
- `@modelcontextprotocol/sdk` dependency
- `zond migrate` command and `src/core/migrations/` module
- `docs/mcp-guide.md`

---

### Tests

- 502 tests total (499 unit + 3 mocked), 0 failures
- New tests: `suite-generator` — reset tag, smoke seeds, logout filter, ETag injection, multipart
- New tests: `data-factory` — maximum constraint, `generateMultipartFromSchema`
- New tests: `serializer` — nested object serialization, `setup: true`
- New tests: `failure-hints` — soft delete hint, `recommended_action`, `classifyFailure`
- New tests: `executor` — header capture, `set:` pinning, setup capture propagation
- New tests: `schema` — `setup: true` round-trip
- Fixed: `mock.module()` cache pollution — coverage tests moved to `tests/mocked/coverage.ts`
  and run in a separate subprocess via `scripts/run-mocked-tests.ts` (bun#7823, bun#12823)
- Fixed: `test:unit` script — added `tests/diagnostics/`, corrected `tests/web/` and
  `tests/reporter/` paths

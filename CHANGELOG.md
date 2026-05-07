# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Deprecated

- **TASK-182: `probe-validation`, `probe-methods`, `probe-mass-assignment`,
  `probe-security` are now aliases for `zond probe <class>`.** The four
  parallel top-level commands have been collapsed under a single
  `zond probe` umbrella (`zond probe validation`, `zond probe methods`,
  `zond probe mass-assignment`, `zond probe security`). Old names
  continue to work for one release and emit a one-line deprecation
  warning to stderr; flags and behaviour are unchanged. The umbrella
  trims top-level `--help` from four lookalike entries to one.

### Added

- **TASK-186: unified `Exporter` interface + sanitizer pipeline.**
  `src/core/exporter/exporter.ts` now defines `Exporter<I, O>` plus a
  `runExporter()` pipeline; `applySanitizer()` is the one place
  sanitization happens. `generateJsonReport` and `generateJunitXml` are
  pure renderers that hand off to `runExporter`. The cli sites that
  used to call `redact()` directly (HTML report, case-study draft,
  probe-mass-assignment digest, probe-security digest) now call
  `applySanitizer()`, signalling the single sanitization seam. New
  exporters get sanitization for free; `redact()` is no longer imported
  from cli/exporter code.
- **TASK-184: typed `--json` envelope helpers (closes TASK-73 / TASK-74).**
  `src/cli/json-envelope.ts` now exports a discriminated-union
  `EnvelopeResult<T>` plus two new entry points: `writeEnvelope(cmd, result)`
  (writes the envelope and returns the exit code) and `withEnvelope(cmd, produce)`
  (wraps an async producer, renders thrown errors as `ok: false`).
  Existing `jsonOk` / `jsonError` / `printJson` keep working — the new
  helpers are an opt-in convenience layer for new commands. Test suite
  pins the success/error/meta/warnings shape end-to-end.

### Changed

- **TASK-185: extract shared probe scaffolding into `core/probe/runner.ts`.**
  The four probe cli commands (`validation`, `methods`, `mass-assignment`,
  `security`) used to each repeat: `readOpenApiSpec` → `extractEndpoints`
  → tag-filter / list-tags → mkdir output → write each suite with
  `autoGenHeader` → record in manifest. That scaffolding now lives in
  two helpers, `loadSpecForProbe` and `writeProbeSuites`, so each cli
  command shrinks to ~100 lines and the suite-emit path is identical
  across them. Live HTTP orchestration in `mass-assignment-probe.ts` /
  `security-probe.ts` is untouched.
- **TASK-183: merge `init.ts` and `init/`.** The `init` command had two
  files that looked like entry points: `src/cli/commands/init.ts`
  (handler) and `src/cli/commands/init/` (helpers). Moved the handler
  into `src/cli/commands/init/index.ts` so the directory is the
  command's only home; behaviour unchanged.
- **TASK-181: sync `install.ps1` ↔ `install.sh`.** PowerShell installer
  now detects ARM64 alongside x64 (was hard-coded to `win-x64`), wraps
  the release-tag fetch in try/catch with a useful error message, and
  matches the .sh installer's tone. The two scripts diverged in late
  April when `install.sh` gained codesign/xattr / fallback-to-local
  logic; this brings them in line for the cross-platform behaviour
  that's actually shared (detection + download + verify).
- **TASK-179: knip cleanup.** Deleted three unused barrel modules
  (`src/core/diagnostics/render-md.ts`, `src/core/parser/index.ts`,
  `src/core/runner/index.ts`), trimmed the `tailwindcss` direct
  dependency (provided transitively by `bun-plugin-tailwind`), and
  stripped 25+ unused `export` keywords across `src/core` and `src/db`
  so symbols become module-private. The historical `executeRun` runner
  in `src/core/runner/execute-run.ts` (superseded by `run.ts`) was
  dropped; only `AUTH_PATH_RE` survives. `knip.json` now treats
  `tests/`, `scripts/`, and `benchmarks/` as entries and silences
  noise on commander `*Options` types and shadcn `*Variants`.
- **TASK-178: build artefacts out of repo root.** `bun run build` now
  emits the compiled binary to `dist/zond` (was `./zond`); the
  codesign-darwin script's default arg follows. The default SQLite path
  is now `<workspace>/.zond/zond.db` (next to `.zond/manifest.json`)
  rather than `<workspace>/zond.db`. Legacy `<workspace>/zond.db` is
  still honoured if present, so existing workspaces keep working without
  a migration step.

### Removed

- **TASK-180: collapse `docs/INDEX.md` and `docs/project-backlog.md`.**
  Both duplicated content already in README + ZOND.md + AGENTS.md.
  Removed; AGENTS.md and README.md updated to point straight at
  `backlog/` and `backlog/decisions/`.
- **TASK-177: remove `.mcp.example.json`.** Leftover from the
  pre-decision-2 MCP integration. MCP support was dropped entirely; the
  example config no longer documents anything.
- **TASK-176: drop `CLAUDE.md`.** The file was a 13-line wrapper that
  pointed Claude Code at `AGENTS.md`. Modern Claude Code reads
  `AGENTS.md` directly, so the redirect is unnecessary. AGENTS.md
  remains the single source of truth for AI agents.

### Changed

- **TASK-151 round-5 follow-up: eventual-consistency retry on POST
  cleanup.** SaaS APIs that route `POST` to a write replica and read
  paths through a follower (Sentry observed this round-5) returned
  404 to immediate `DELETE` cleanup, even though the resource existed
  ~10s later. `tryCleanup` now retries 404 with two short backoffs
  (default 200ms / 1s, configurable via `cleanupRetryDelaysMs`). A
  404 that survives retries is flagged
  `persisted across retries — likely real leak`. 5xx, network
  errors, 401/403 fail fast (not transient).
- **Skill: documented CI exit codes.** Phase 5.2 now states that
  `zond probe-security` exits non-zero on either `HIGH > 0` or
  `cleanup.error > 0`, and that `grep -q "Cleanup failures"
  digest.md` is a reliable signal for the latter.

- **TASK-151 round-4 follow-up: per-field restore + cleanup-failure
  surfacing.** The first cut of snapshot+restore sent the full GET
  body back as a single PUT, which `422`'d on partial-PUT APIs (Sentry,
  Stripe) — the round-3 user re-ran the probe and found `org.name`,
  `project.name`, `project.subjectPrefix` left as the attack payload.
  Fixes:
    1. `restoreOriginal` now replays each dirty field as its own
       single-key PUT, so partial-PUT APIs accept it. Caller passes the
       set of mutated keys (full-baseline → all body keys, partial
       baseline / per-attack → just the targeted field).
    2. `findDeleteCounterpart` / `findGetByIdCounterpart` are
       trailing-slash tolerant. `POST /keys/` + `DELETE /keys/{id}/`
       now matches; previously the regex required identical slash forms
       and silently leaked DSN keys.
    3. POST cleanup failures (no DELETE counterpart, missing id, DELETE
       4xx, network error) accumulate into `verdict.cleanup.error`.
    4. `formatSecurityDigest` prints a mandatory
       `## ⚠️ Cleanup failures` section first when any verdict has a
       cleanup error, plus a `🧹 cleanup-failure` tag next to the
       verdict line in its severity bucket. The CLI now exits non-zero
       on cleanup failures (data-integrity gate, distinct from the
       HIGH-finding gate).

- **TASK-151: `probe-security` snapshot+restore cleanup for PUT/PATCH.**
  Cleanup used to be `DELETE-if-2xx`, which silently destroyed live data
  on rename'ы — a probe overwrote a Sentry DSN-key with the attack
  payload and left it that way. probe-security now does a `GET` before
  baseline (when there's a GET counterpart on the same path),
  caches the original body, and restores it via `PUT`/`PATCH` after
  every 2xx response. Strips read-only fields (`id`, `created_at`,
  `updated_at`) from the restore body, forwards `If-Match` when
  `requiresEtag` is set, and surfaces restore failures in
  `verdict.cleanup.error` so they show up in the digest. POST keeps
  the existing `DELETE`-counterpart cleanup.

- **TASK-152: `probe-security` partial-body fallback on PUT/PATCH.**
  Sentry / Stripe / GitHub-shaped APIs accept partial PUT — sending the
  spec's full body returns `422` and the proven-HIGH CRLF on
  `subjectPrefix` lands in `INCONCLUSIVE-BASELINE`. probe-security now
  retries the baseline with a single-key body per detected field; if any
  partial baseline succeeds, attacks proceed using that shape and the
  finding `reason` is annotated `[partial-body]`. Only PUT/PATCH —
  partial bodies on POST would just trip required-field validation.

### Added

- **TASK-138: `zond probe-security <classes>` — live SSRF / CRLF /
  open-redirect probes.** Replaces the markdown templates the audit skill
  used to ship for Phase 5.2/5.3 (one HIGH stored CRLF on Sentry came
  from one of those templates — but only after hand-copying it per
  endpoint). Detects vulnerable fields by name + `format` hints
  (`*_url` / `webhook` / `format: uri` for SSRF; `subject` / `*_prefix`
  / `name` / `description` for CRLF; `redirect` / `next` / `return_to`
  for open-redirect), sends a **baseline-OK** request first (skips the
  endpoint with `INCONCLUSIVE-BASELINE` if baseline ≠ 2xx — eliminates
  the 5×404 noise the markdown templates produced on scope-locked
  endpoints), then attacks each detected field with the class's
  payloads. Classifies HIGH (5xx **or** payload echoed in 2xx body —
  stored injection candidate), LOW (2xx, no echo — verify manually),
  OK (4xx). Idempotent cleanup via DELETE counterpart. `--dry-run`
  enumerates fields without sending requests. `--emit-tests <dir>`
  produces regression YAML suites with `always: true` cleanup.

- **TASK-137: `probe-mass-assignment` body-FK auto-discovery.** Required
  body fields named `*_id` / `*_slug` / `*_uuid` / `*_key` are now resolved
  pre-baseline by hitting the matching collection list endpoint
  (`audience_id` → `GET /audiences`). Eliminates most
  `inconclusive-baseline` noise, where the spec-generated random UUID was
  rejected before extras ever reached validation. Enabled by default
  (gated by the existing `--discover` / `--no-discover` flag — same as
  the path-param discovery from TASK-92). When discovery still misses an
  FK, the INCONCLUSIVE summary now lists the unresolved field names so
  the user knows exactly what to add to env. Follow-up
  `--retry-inconclusive <run-id>` tracked as TASK-150.

- **TASK-136: `zond discover --api <name>` — auto-fill `.env.yaml` FK ids
  from list-endpoints.** Phase 2.5 of an audit used to be manual: hit
  `GET /audiences`, `GET /projects`, etc., copy slugs into `.env.yaml`,
  repeat for every FK. `discover` walks `.api-resources.yaml`, finds owner
  list-endpoints for each path-FK var, calls them with the workspace
  `auth_token`, and proposes a diff. Suffix-aware extraction (`*_slug` →
  `slug`, `*_uuid` → `uuid`, `*_id` → `id`). Default dry-run; `--apply`
  writes with a `.env.yaml.bak` backup. Skips vars already filled with a
  non-placeholder value. v1 limitation: only collection-level list
  endpoints (no nested paths — that's TASK-137 territory).

- **TASK-139: `zond generate --explain`.** Prints a per-POST diagnostic table
  (`resource | post | get/{id} | put/patch | delete | list | verdict | reason`)
  without writing files, so you can debug "why didn't `generate` emit a CRUD
  chain for resource X?" against a real spec. Pairs with the relaxed
  detector below.

### Changed

- **TASK-139: relaxed CRUD detector — trailing slashes and id-like field
  names.** `detectCrudGroups` now matches `POST /alerts/` against
  `GET /alerts/{id}` (and any combination of trailing slashes), and
  `getCaptureField` looks for the path-param name (`{slug}` → `slug`,
  `{rule_id}` → `id`/`rule_id`) plus `slug`/`uuid`/`key`/`version`/`name`
  string fields before falling back to type-shape heuristics. Together
  these produce CRUD chains for Sentry-style resources (alert-rules,
  dashboards, releases) that previously fell through the strict regex.

### Changed

- **TASK-135: `probe-validation` no longer short-circuits on parent path
  params.** Probes now emit non-attacked path parameters as runtime
  placeholders (`{{organization_id_or_slug}}`) so `zond run` resolves them
  from `.env.yaml`. Previously every parent slot was baked as the
  synthetic sentinel `nonexistent-zzzzz`, which made nested-path probes
  return 404 from the parent before the leaf validator ever fired —
  hiding real 5xx bugs in `repos/{repo}/commits`-style endpoints. Use
  `--no-real-parents` to keep the legacy fully-synthetic rendering.

### Added

- **TASK-110: `zond report case-study <failure-id>` — markdown drafts for
  one failure.** Companion to TASK-107: zooms into a single `results.id`
  and produces a ready-to-edit case-study (TL;DR, spec snippet, curl,
  response, "why it matters", provenance) primed for `gh issue create
  --body-file -` or a Slack write-up. Powers a **Case study draft**
  button on the Run detail UI (clipboard via
  `GET /api/results/:id/case-study.md`). Missing fields become explicit
  `<TODO: ...>` placeholders.

- **TASK-107: `zond report export <run-id>` — single-file HTML run reports.**
  Materialises a stored run as a self-contained HTML (inline CSS + JS, no
  external assets) you can attach to a GitHub issue, drop into Slack, or
  archive offline. Includes pass-rate ring, KPI strip, collapsible failure
  cards with provenance + frozen OpenAPI excerpts, **Copy curl** and
  **Copy as GitHub issue** buttons, failure-class filter chips, and an
  endpoint × method coverage map. Light/dark themes via
  `prefers-color-scheme`; print-friendly for browser-PDF export.

### Breaking

- **TASK-73: top-level `--json` removed.** `--json` was previously a global
  option that propagated to every subcommand; on `run` it collided with
  `--report json` and crashed (`paths[0] must be of type string`). It is now
  a per-command option attached only to subcommands that produce a JSON
  envelope. **Migration**: replace `zond run … --json` with
  `zond run … --report json`. Other commands (`db diagnose --json`,
  `validate --json`, `coverage --json`, …) keep working unchanged — only
  the flag's scope changed, not its meaning.

### Round-2 papercuts continued (TASK-70 / TASK-72 / TASK-75)

- **TASK-72: `--tag` no longer silently swallows YAML parse errors.** Tag
  filter prints every parse error as a warning; if every file fails to parse
  the run exits 2; if the tag filter empties to zero AND parse errors exist,
  the run exits 1 with a message pointing at the parse failures instead of
  the misleading "No suites match the specified tags".

- **TASK-75: pre-flight `{{var}}` check + `--strict-vars`.** Every `{{var}}`
  reference is checked against env, parameterize, set keys and prior-step
  captures before a request goes out. Missing references emit a warning by
  default; `--strict-vars` makes them a hard-fail (exit 2) so CI catches
  typos before the server returns "invalid email format".

- **TASK-70: env_issue overrides per-failure recommendation.** When
  `db diagnose` detects a run-level env_issue, every non-5xx failure's
  `recommended_action` becomes `fix_env` and the misleading per-failure
  hint/schema_hint is suppressed. Real backend bugs (5xx) keep
  `report_backend_bug`.

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

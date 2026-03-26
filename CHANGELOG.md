# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — fix/generator-quality-improvements

### Breaking changes

- **MCP layer removed** — `zond mcp` command and `@modelcontextprotocol/sdk` dependency deleted.
  The agent interface is now exclusively the CLI + skills in `skills/`. No migration path needed.

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

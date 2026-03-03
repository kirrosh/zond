# Changelog

All notable changes to this project will be documented in this file.

## [0.5.4] - 2026-03-03

### Fixed

- **`execute-run.ts`**: removed stale `"default"` fallback for `effectiveEnvName` — when no `envName` was passed but a collection existed, the runner looked for `.env.default.yaml` instead of `.env.yaml`, causing all variables (including `base_url`) to be empty and every request to fail with `"URL is invalid"`

### Added

- **`executor.ts`**: early URL validation before `fetch()` — if `base_url` is missing or empty the step now fails immediately with a descriptive error `"base_url is not configured — URL resolved to a relative path: …"` instead of the cryptic `TypeError: URL is invalid`; subsequent steps that depend on captures from the failed step are automatically skipped
- **`diagnose_failure`**: `envHint()` detector — surfaces actionable `.env.yaml` hints per failure:
  - relative URL → `"base_url is not set or empty — add base_url to <path>/.env.yaml"`
  - URL contains `{{variable}}` → `"URL contains unresolved variable — check variable names in .env.yaml"`
  - error message contains `"URL is invalid"` → `"URL is malformed — likely base_url is empty or invalid"`
  - env hints take priority over generic `statusHint` (401/404/5xx)
  - new top-level `env_issue` field when ALL failures share the same env problem category
  - env file path resolved from `collection.base_dir` — agent sees the exact file to edit
- **`run_tests` MCP**: always suggests `manage_server(action: 'start')` in `hints` after a run
- **`generate_tests_guide` / `generate_missing_tests` descriptions**: mention `manage_server` as the next step after saving and running tests

## [Unreleased]

### Added

- **MCP feedback improvements**
  - `diagnose_failure` now includes `response_headers` in failure output (e.g. `X-Ably-ErrorMessage`)
  - `generate_tests_guide`: annotates `any`-typed request bodies with a warning comment
  - `generate_tests_guide`: added 204 No Content tips in Practical Tips and Common Mistakes sections
  - `schema-utils.ts`: added `isAnySchema()` helper
  - DB schema v6: `results.response_headers TEXT` column

- **M22: MCP-first smart test generation**
  - `generate_tests_guide` MCP tool — returns full API spec with schemas + step-by-step generation algorithm
  - `save_test_suite` MCP tool — validates YAML and saves test files with structured error reporting
  - `explore_api` enhanced — new `includeSchemas` parameter for full request/response body schemas
  - `schema-utils.ts` — extracted `compressSchema()` and `formatParam()` as shared utilities
  - Improved MCP tool descriptions with "when to use" guidance

### Removed

- `list_environments` MCP tool — duplicated by `manage_environment(action: "list")`

---

## [0.3.0] - Unreleased (post-M21)

### Added

- **Environment management in WebUI** — full CRUD for environments (`/environments`)
- **Key-value editor** — add/remove variables with inline JavaScript
- **Environment selector** — `<select name="env">` dropdown in collection "Run Tests" form
- **DB queries** — `getEnvironmentById()`, `deleteEnvironment()`, `listEnvironmentRecords()`
- **Navigation** — "Environments" link in navbar
- **Improved runs filter** — environment dropdown merges defined environments + run history
- **Self-documented API** — routes use `@hono/zod-openapi`, `GET /api/openapi.json` serves spec
- **Incremental generation** — `apitool generate` skips already-covered endpoints
- **Dogfooding** — integration tests run against apitool's own API
- **Generator: `additionalProperties`** — Record types generate sample key-value pairs instead of `{}`
- **CI: typecheck** — `tsc --noEmit` step added to CI pipeline

### Changed

- **Auth-flow test** — rewritten with inline OpenAPI server (no external `test-server/` dependency)

### Removed

- **`test-server/`** — replaced by inline test servers in integration tests
- **Duplicate spec files** — `openapi-self.json`, `self-tests-spec.json` removed from project root

### Fixed

- **Type errors** — `z.coerce.number()` in schemas, `c.body()` return type in export route
- **Environments CRUD skeleton** — `variables` field now generates test data correctly

## [0.1.0] - 2025-02-27

Initial public release.

### Features

- **YAML test definitions** — declarative API tests with steps, assertions, variables, and captures
- **Test runner** — sequential HTTP execution with variable substitution, chained captures, and configurable timeouts
- **Assertions** — status code, JSON body (exact, contains, path), headers, response time
- **Environment files** — `.env.<name>.yaml` for per-environment variables (base URLs, tokens, etc.)
- **OpenAPI test generator** — generate skeleton YAML tests from OpenAPI 3.x specs (CRUD operations, auth-aware)
- **AI-powered test generation** — generate tests using LLM providers (Ollama, OpenAI, Anthropic, custom)
- **Reporters** — console (colored), JSON, JUnit XML output formats
- **SQLite storage** — persist test runs, results, and collections in `apitool.db`
- **WebUI dashboard** — Hono + HTMX web interface with:
  - Run history with filters and trend charts
  - Suite detail view with per-step results
  - API Explorer with request builder and authorization panel
  - Collection management with drill-down
  - AI test generation UI
  - Result export (JSON, JUnit)
- **CLI commands**:
  - `apitool run <path>` — execute tests with env, reporter, timeout, bail options
  - `apitool validate <path>` — validate YAML test files
  - `apitool generate --from <spec>` — generate tests from OpenAPI
  - `apitool ai-generate --from <spec> --prompt "..."` — AI test generation
  - `apitool serve` — start web dashboard
  - `apitool collections` — list test collections
- **Multi-auth support** — Basic, Bearer, API Key auth in CLI (`--auth-token`) and WebUI
- **Standalone binary** — single-file executable via `bun build --compile`

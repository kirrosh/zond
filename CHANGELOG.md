# Changelog

All notable changes to this project will be documented in this file.

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

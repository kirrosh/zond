/**
 * Single source of truth for all MCP tool descriptions.
 * Update descriptions here — they are imported by each tool file.
 */
export const TOOL_DESCRIPTIONS = {
  setup_api:
    "Register a new API for testing. Creates directory structure, reads OpenAPI spec, " +
    "sets up environment variables, and creates a collection in the database. " +
    "Use this before generating tests for a new API. " +
    "Warns if spec has relative server URL. Use insecure: true for self-signed HTTPS certs.",

  describe_endpoint:
    "Full details for one endpoint: params grouped by type, request body schema, " +
    "all response schemas + response headers, security, deprecated flag. " +
    "Use when a test fails and you need complete endpoint spec without reading the whole file.",

  run_tests:
    "Execute API tests from a YAML file or directory and return results summary with failures. " +
    "Use after saving test suites with save_test_suite. Check query_db(action: 'diagnose_failure') for detailed failure analysis.",

  query_db:
    "Query the zond database. Actions: list_collections (all APIs with run stats), " +
    "list_runs (recent test runs), get_run_results (full detail for a run), " +
    "diagnose_failure (only failed/errored steps for a run — each failure includes failure_type: api_error/assertion_failed/network_error, " +
    "and summary includes api_errors/assertion_failures/network_errors counts; stack traces are truncated by default, use verbose: true for full traces), " +
    "compare_runs (regressions and fixes between two runs).",

  coverage_analysis:
    "Compare an OpenAPI spec against existing test files to find untested endpoints. " +
    "Use to identify gaps and prioritize which endpoints to generate tests for next. " +
    "Pass runId to get enriched pass/fail/5xx breakdown per endpoint. " +
    "Always includes static spec warnings (deprecated, missing response schemas, required params without examples).",

  send_request:
    "Send an ad-hoc HTTP request. Supports variable interpolation from environments (e.g. {{base_url}}). " +
    "Use jsonPath to extract a subset of the response (e.g. '[0].code'), maxResponseChars to truncate large responses.",

  manage_server:
    "Start, stop, restart, or check status of the zond WebUI server. " +
    "Useful for viewing test results in a browser without leaving the MCP session.",

  ci_init:
    "Generate a CI/CD workflow file for running API tests automatically on push, PR, and schedule. " +
    "Supports GitHub Actions and GitLab CI. Auto-detects platform from project structure " +
    "(.github/ → GitHub, .gitlab-ci.yml → GitLab). " +
    "Use after tests are generated and passing. After generating the workflow, help the user commit and push to activate CI.",
} as const;

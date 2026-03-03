/**
 * Single source of truth for all MCP tool descriptions.
 * Update descriptions here — they are imported by each tool file.
 */
export const TOOL_DESCRIPTIONS = {
  set_work_dir:
    "Set the working directory for this MCP session. " +
    "Call this FIRST before any other tool when using a shared MCP server (npx). " +
    "Determines where apitool.db and relative test paths resolve to. " +
    "Pass the absolute path to your project root (same as workspace root in your editor).",

  setup_api:
    "Register a new API for testing. Creates directory structure, reads OpenAPI spec, " +
    "sets up environment variables, and creates a collection in the database. " +
    "Use this before generating tests for a new API.",

  explore_api:
    "Explore an OpenAPI spec — list endpoints, servers, and security schemes. " +
    "Use with includeSchemas=true when generating tests to get full request/response body schemas.",

  describe_endpoint:
    "Full details for one endpoint: params grouped by type, request body schema, " +
    "all response schemas + response headers, security, deprecated flag. " +
    "Use when a test fails and you need complete endpoint spec without reading the whole file.",

  generate_tests_guide:
    "Get a comprehensive guide for generating API test suites. " +
    "Returns the full API specification (with request/response schemas) and a step-by-step algorithm " +
    "for creating YAML test files. Use this BEFORE generating tests — it gives you " +
    "everything you need to write high-quality test suites. " +
    "After generating, use save_test_suite to save, run_tests to execute, and query_db(action: 'diagnose_failure') to debug.",

  generate_missing_tests:
    "Analyze test coverage and generate a test guide for only the uncovered endpoints. " +
    "Combines coverage_analysis + generate_tests_guide — returns a focused guide for missing tests. " +
    "Use this for incremental test generation to avoid duplicating existing tests.",

  save_test_suite:
    "Save a YAML test suite file with validation. Parses and validates the YAML content " +
    "before writing. Returns structured errors if validation fails so you can fix and retry. " +
    "Use after generating test content with generate_tests_guide.",

  save_test_suites:
    "Save multiple YAML test suite files in a single call. Each file is validated before writing. " +
    "Returns per-file results. Use when you have generated multiple suites at once.",

  validate_tests:
    "Validate YAML test files without running them. Returns parsed suite info or validation errors.",

  run_tests:
    "Execute API tests from a YAML file or directory and return results summary with failures. " +
    "Use after saving test suites with save_test_suite. Check query_db(action: 'diagnose_failure') for detailed failure analysis.",

  query_db:
    "Query the apitool database. Actions: list_collections (all APIs with run stats), " +
    "list_runs (recent test runs), get_run_results (full detail for a run), " +
    "diagnose_failure (only failed/errored steps for a run), " +
    "compare_runs (regressions and fixes between two runs).",

  coverage_analysis:
    "Compare an OpenAPI spec against existing test files to find untested endpoints. " +
    "Use to identify gaps and prioritize which endpoints to generate tests for next.",

  send_request:
    "Send an ad-hoc HTTP request. Supports variable interpolation from environments (e.g. {{base_url}}).",

  manage_server:
    "Start, stop, restart, or check status of the apitool WebUI server. " +
    "Useful for viewing test results in a browser without leaving the MCP session.",

  ci_init:
    "Generate a CI/CD workflow file for running API tests automatically on push, PR, and schedule. " +
    "Supports GitHub Actions and GitLab CI. Auto-detects platform from project structure " +
    "(.github/ → GitHub, .gitlab-ci.yml → GitLab). " +
    "Use after tests are generated and passing. After generating the workflow, help the user commit and push to activate CI.",
} as const;

---
description: Start testing an API — register, generate tests, run, and diagnose
argument-hint: "[path-to-openapi-spec]"
---

You are orchestrating a full API test generation workflow using the zond MCP tools.

## Instructions

1. **Set working directory:**
   ```
   set_work_dir(workDir: "<current project root>")
   ```

2. **Determine the OpenAPI spec path:**
   - If `$ARGUMENTS` is provided, use it as the spec path
   - Otherwise, search for common OpenAPI spec files in the project: `openapi.json`, `openapi.yaml`, `openapi.yml`, `swagger.json`, `swagger.yaml`, `api-spec.json`, `api-spec.yaml`
   - If no spec found, ask the user for the path

3. **Register the API:**
   ```
   setup_api(name: "<auto-detected from spec or directory name>", specPath: "<spec-path>")
   ```

4. **Check existing coverage:**
   ```
   coverage_analysis(specPath: "<spec-path>", testsDir: "<tests-dir>")
   ```
   Show the user the current coverage status.

5. **Generate GET-only smoke tests:**
   ```
   generate_and_save(specPath: "<spec-path>", methodFilter: ["GET"])
   ```
   Save the generated tests with `save_test_suites`. Tag all suites with `tags: [smoke]`.

6. **Run tests in safe mode:**
   ```
   run_tests(testPath: "<tests-dir>", safe: true)
   ```

7. **If any tests fail**, diagnose them:
   ```
   query_db(action: "diagnose_failure", runId: <run-id>)
   ```
   Explain the failures to the user and suggest fixes.

8. **Summary and next steps:**
   - Show pass/fail counts
   - Show coverage percentage
   - Recommend Phase 2 (CRUD tests) if the user has a staging environment
   - Recommend `manage_server(action: "start")` for visual review
   - Recommend `/zond:api-coverage` to check and fill coverage gaps

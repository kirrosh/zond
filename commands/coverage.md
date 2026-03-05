---
description: "Analyze API test coverage and generate tests for gaps"
argument-hint: "[path-to-openapi-spec]"
---

You are checking API test coverage and helping fill gaps using zond MCP tools.

## Instructions

1. **Set working directory:**
   ```
   set_work_dir(workDir: "<current project root>")
   ```

2. **Determine the OpenAPI spec path:**
   - If `$ARGUMENTS` is provided, use it as the spec path
   - Otherwise, search for common OpenAPI spec files: `openapi.json`, `openapi.yaml`, `openapi.yml`, `swagger.json`, `swagger.yaml`
   - If no spec found, ask the user

3. **Find existing tests directory:**
   - Look for `apis/*/tests/` directories or `tests/` in project root
   - If no tests found, inform the user and suggest using `/zond:test` first

4. **Run coverage analysis:**
   ```
   coverage_analysis(specPath: "<spec-path>", testsDir: "<tests-dir>")
   ```

5. **Present results to the user:**
   - Total endpoints in spec
   - Covered endpoints (with test files)
   - Uncovered endpoints (list them)
   - Static warnings (deprecated, missing schemas, required params without examples)
   - Coverage percentage

6. **If there are uncovered endpoints**, offer to generate tests:
   - Ask the user if they want to generate tests for uncovered endpoints
   - If yes, use:
     ```
     generate_and_save(specPath: "<spec-path>", testsDir: "<tests-dir>", methodFilter: ["GET"])
     ```
   - Save with `save_test_suites`
   - Run new tests: `run_tests(testPath: "<tests-dir>", safe: true)`

7. **Show updated coverage:**
   ```
   coverage_analysis(specPath: "<spec-path>", testsDir: "<tests-dir>")
   ```
   Compare before/after coverage percentages.

8. **Recommend next steps:**
   - If coverage < 60%: suggest generating more tests
   - If coverage >= 60%: suggest setting up CI with `ci_init()`
   - Recommend CRUD tests for full coverage (with staging env confirmation)

## Important Rules
- Use MCP tools for analysis (generate_and_save, coverage_analysis, describe_endpoint)
- Use Read + Edit for fixing individual test YAML files — NOT save_test_suites
- save_test_suites is for initial bulk save only
- Do NOT use Bash to parse OpenAPI specs — MCP tools handle this

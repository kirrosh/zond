---
name: debug-test-failures
description: This skill should be used when API tests fail, when the user asks to "fix broken tests", "debug API errors", "diagnose test failures", "interpret test results", or "why did my tests fail" from zond.
---

# Debug Test Failures

Systematic workflow for diagnosing and fixing failed API tests.

## Step 1 — Get Failure Details

```
query_db(action: "diagnose_failure", runId: <run-id>)
```

If you don't have the run ID, find it first:
```
query_db(action: "list_runs", limit: 5)
```

The response includes:
- **failure_type** for each failed step: `api_error`, `assertion_failed`, or `network_error`
- **envHint** — diagnostic hint for environment-related issues
- **response_body** — actual response received
- **summary** — aggregated counts by failure type

## Step 2 — Classify Failures

### `network_error` — Cannot reach the server

**Common causes:**
- Server is not running
- Wrong `base_url` in `.env.yaml`
- Firewall or DNS issue

**Fix:** Check the server is accessible, verify `base_url` is correct.

### `api_error` — Server returned an error (4xx/5xx)

**Check the HTTP status code:**

| Status | Likely cause | Fix |
|--------|-------------|-----|
| 401 | Missing or invalid auth token | Update `auth_token` in `.env.yaml` |
| 403 | Insufficient permissions | Check API key scopes/roles |
| 404 | Wrong endpoint path or missing resource | Verify path with `describe_endpoint`, check path params |
| 422 | Invalid request body | Check required fields with `describe_endpoint` |
| 500 | Server bug | Check server logs, report upstream |

### `assertion_failed` — Response didn't match expectations

**Common causes:**
- Wrong expected status code
- Wrong field type (e.g., expecting `integer` but getting `string`)
- Field name mismatch (case sensitivity, nesting)
- Array response when expecting object (use `_body: { type: "array" }`)

## Step 3 — Check envHint

The `envHint` field provides specific diagnostics:

| envHint | Meaning | Fix |
|---------|---------|-----|
| Relative URL detected | `base_url` is missing — request URL starts with `/` instead of `https://...` | Add `base_url` to `.env.yaml` |
| Unresolved variable `{{var}}` | A `{{variable}}` was not replaced — missing from environment | Add the variable to `.env.yaml` or pass via `envVars` |
| Malformed URL | URL is not valid after variable substitution | Check `.env.yaml` for typos in `base_url` |

When `envHint` is present, fix the environment first before investigating other issues.

## Step 4 — Fix the Issue

### Environment issues
Edit `.env.yaml` in the API base directory:
```yaml
base_url: https://api.example.com
auth_token: your-valid-token
```

### Assertion mismatches
1. Check the actual response in `response_body`
2. Verify endpoint contract with:
   ```
   describe_endpoint(specPath: "<spec>", method: "GET", path: "/users/{id}")
   ```
3. Update the test YAML to match actual API behavior

### Endpoint issues
Test the endpoint manually:
```
send_request(method: "GET", url: "https://api.example.com/users/1",
             headers: '{"Authorization": "Bearer token"}')
```

## Workflow Rules

- **Read + Edit for fixes**: Read YAML test file, Edit specific lines. Do NOT use save_test_suites for point fixes.
- **diagnose_failure is often sufficient**: Contains actual request/response/status. Load describe_endpoint only if context is insufficient.
- **No Bash for spec parsing**: describe_endpoint and coverage_analysis already handle this.

## Step 5 — Verify the Fix

1. **Re-run tests:**
   ```
   run_tests(testPath: "<tests-dir>")
   ```

2. **Compare with previous run:**
   ```
   query_db(action: "compare_runs", runId: <failed-run>, runIdB: <new-run>)
   ```
   This shows regressions (new failures) and fixes (previously failing, now passing).

## Step 6 — Visual Review

Launch the Web UI for a visual overview:
```
manage_server(action: "start")
```

The dashboard shows:
- Health strip — pass/fail distribution across endpoints
- Per-endpoint status with latest results
- Suite-level and step-level details with assertion results and response bodies

## References

See [references/error-patterns.md](references/error-patterns.md) for detailed error patterns and solutions.

# Error Patterns Reference

Detailed reference for common API test failure patterns and their solutions.

## HTTP Error Codes

### 401 Unauthorized

**Symptoms:** All or most tests fail with 401.

**Causes:**
- Missing `auth_token` in `.env.yaml`
- Expired token
- Wrong auth header format (e.g., `Bearer` vs `Basic`)

**Solutions:**
1. Check `.env.yaml` has valid `auth_token`
2. Verify the auth header format matches API requirements:
   ```yaml
   headers:
     Authorization: "Bearer {{auth_token}}"
   ```
3. Generate a new token if expired
4. Check if the API uses a different auth mechanism (API key, Basic auth)

### 403 Forbidden

**Symptoms:** Specific endpoints fail with 403.

**Causes:**
- API key doesn't have required scopes
- Role-based access — test user lacks permissions
- IP allowlisting

**Solutions:**
1. Check API documentation for required scopes/roles
2. Use a token with appropriate permissions
3. Verify the test environment allows your IP

### 404 Not Found

**Symptoms:** Individual tests fail with 404.

**Causes:**
- Typo in endpoint path
- Missing path parameter (e.g., `/users/{id}` without `id`)
- Resource doesn't exist in test environment
- API version mismatch (e.g., `/v1/` vs `/v2/`)

**Solutions:**
1. Verify path with `describe_endpoint(specPath, method, path)`
2. Ensure path parameters are captured and interpolated correctly
3. Check `base_url` includes the correct API prefix

### 422 Unprocessable Entity

**Symptoms:** POST/PUT tests fail with 422.

**Causes:**
- Missing required fields in request body
- Wrong field types (string instead of integer)
- Validation rules not met (email format, min/max length)

**Solutions:**
1. Check request body schema: `describe_endpoint(specPath, method, path)`
2. Ensure all required fields are present
3. Use generators for valid random data: `{{$randomEmail}}`, `{{$randomName}}`

### 500 Internal Server Error

**Symptoms:** Tests intermittently or consistently fail with 500.

**Causes:**
- Server-side bug triggered by test data
- Database connection issues on the server
- Missing server-side dependencies

**Solutions:**
1. Check server logs for stack traces
2. Try with simpler request data
3. Report to API maintainers if consistent

## Environment Hints (envHint)

### Relative URL Detected

**What it means:** The test made a request to `/users` instead of `https://api.example.com/users`. The `base_url` variable is missing.

**How to fix:**
```yaml
# .env.yaml
base_url: https://api.example.com
```

### Unresolved Variable

**What it means:** A `{{variable_name}}` in the test was not replaced. The variable is missing from the environment.

**How to fix:**
1. Identify the variable name from the error
2. Add it to `.env.yaml`:
   ```yaml
   base_url: https://api.example.com
   variable_name: actual-value
   ```
3. Or pass at runtime:
   ```
   run_tests(testPath: "...", envVars: { "variable_name": "value" })
   ```

### Malformed URL

**What it means:** After variable substitution, the URL is not valid. Usually a typo in `base_url`.

**How to fix:**
1. Check `.env.yaml` — ensure `base_url` starts with `http://` or `https://`
2. Ensure no trailing whitespace or newlines
3. Verify no double slashes in paths (e.g., `https://api.com//users`)

## Assertion Mismatches

### Type Mismatch

**Problem:** Expected `type: "integer"` but got a string like `"42"`.

**Fix:** Some APIs return numbers as strings. Use `type: "string"` or `equals` with string value.

### Nested Field Access

**Problem:** Assertion on `user.name` fails because the response structure is different.

**Fix:** Check actual response in `response_body`. Common issues:
- Response wraps data in `{ data: { user: { name: "..." } } }` — use `data.user.name`
- Array response — use `_body: { type: "array" }` for root array, or `[0].name` for first element

### Array vs Object

**Problem:** Expected an object but got an array.

**Fix:** Use `_body: { type: "array" }` for list endpoints. For individual items within arrays, access by index or restructure the test.

### Status Code Mismatch

**Problem:** Expected `status: 200` but got `201` for a POST endpoint.

**Fix:** Use an array of allowed codes:
```yaml
expect:
  status: [200, 201]
```

## Debugging Tools

### describe_endpoint

Get the full contract for an endpoint:
```
describe_endpoint(specPath: "spec.json", method: "GET", path: "/users/{id}")
```

Returns: params (path, query, header), request body schema, all response schemas, security requirements.

### send_request

Test an endpoint manually:
```
send_request(
  method: "GET",
  url: "{{base_url}}/users/1",
  headers: '{"Authorization": "Bearer {{auth_token}}"}',
  collectionName: "myapi",
  envName: "staging"
)
```

Supports variable interpolation from environments when `collectionName` is provided.

For large responses, use `jsonPath` to extract a subset (e.g. `[0].code`, `data.items`), or `maxResponseChars` to truncate.

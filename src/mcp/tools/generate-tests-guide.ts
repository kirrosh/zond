import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../core/generator/index.ts";
import type { EndpointInfo, SecuritySchemeInfo } from "../../core/generator/types.ts";
import { compressSchema, formatParam, isAnySchema } from "../../core/generator/schema-utils.ts";

export function registerGenerateTestsGuideTool(server: McpServer) {
  server.registerTool("generate_tests_guide", {
    description: "Get a comprehensive guide for generating API test suites. " +
      "Returns the full API specification (with request/response schemas) and a step-by-step algorithm " +
      "for creating YAML test files. Use this BEFORE generating tests — it gives you " +
      "everything you need to write high-quality test suites. " +
      "After generating, use save_test_suite to save, run_tests to execute, and query_db(action: 'diagnose_failure') to debug.",
    inputSchema: {
      specPath: z.string().describe("Path or URL to OpenAPI spec file"),
      outputDir: z.optional(z.string()).describe("Directory for saving test files (default: ./tests/)"),
      methodFilter: z.optional(z.array(z.string())).describe("Only include endpoints with these HTTP methods (e.g. [\"GET\"] for smoke tests)"),
    },
  }, async ({ specPath, outputDir, methodFilter }) => {
    try {
      const doc = await readOpenApiSpec(specPath);
      let endpoints = extractEndpoints(doc);
      if (methodFilter && methodFilter.length > 0) {
        const methods = methodFilter.map(m => m.toUpperCase());
        endpoints = endpoints.filter(ep => methods.includes(ep.method.toUpperCase()));
      }
      const securitySchemes = extractSecuritySchemes(doc);
      const baseUrl = ((doc as any).servers?.[0]?.url) as string | undefined;
      const title = (doc as any).info?.title as string | undefined;

      const apiContext = compressEndpointsWithSchemas(endpoints, securitySchemes);
      const guide = buildGenerationGuide({
        title: title ?? "API",
        baseUrl,
        apiContext,
        outputDir: outputDir ?? "./tests/",
        securitySchemes,
        endpointCount: endpoints.length,
      });

      return {
        content: [{ type: "text" as const, text: guide }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }],
        isError: true,
      };
    }
  });
}

export function compressEndpointsWithSchemas(
  endpoints: EndpointInfo[],
  securitySchemes: SecuritySchemeInfo[],
): string {
  const lines: string[] = [];

  if (securitySchemes.length > 0) {
    lines.push("SECURITY SCHEMES:");
    for (const s of securitySchemes) {
      let desc = `  ${s.name}: ${s.type}`;
      if (s.scheme) desc += ` (${s.scheme})`;
      if (s.bearerFormat) desc += ` [${s.bearerFormat}]`;
      if (s.in && s.apiKeyName) desc += ` (${s.apiKeyName} in ${s.in})`;
      lines.push(desc);
    }
    lines.push("");
  }

  lines.push("ENDPOINTS:");
  for (const ep of endpoints) {
    const summary = ep.summary ? ` — ${ep.summary}` : "";
    const security = ep.security.length > 0 ? `  [auth: ${ep.security.join(", ")}]` : "";
    lines.push(`\n${ep.method} ${ep.path}${summary}${security}`);

    // Parameters
    const pathParams = ep.parameters.filter(p => p.in === "path");
    const queryParams = ep.parameters.filter(p => p.in === "query");
    const headerParams = ep.parameters.filter(p => p.in === "header");
    if (pathParams.length > 0) {
      lines.push(`  Path params: ${pathParams.map(p => formatParam(p)).join(", ")}`);
    }
    if (queryParams.length > 0) {
      lines.push(`  Query params: ${queryParams.map(p => formatParam(p)).join(", ")}`);
    }
    if (headerParams.length > 0) {
      lines.push(`  Header params: ${headerParams.map(p => formatParam(p)).join(", ")}`);
    }

    // Request body with full schema
    if (ep.requestBodySchema) {
      const contentType = ep.requestBodyContentType ?? "application/json";
      const anyBody = isAnySchema(ep.requestBodySchema);
      const bodyLine = anyBody
        ? `any  # ⚠️ spec defines body as 'any' — actual required fields unknown, test may need manual adjustment`
        : compressSchema(ep.requestBodySchema);
      lines.push(`  Request body (${contentType}): ${bodyLine}`);
    }

    // Responses with schemas
    for (const resp of ep.responses) {
      const schemaStr = resp.schema ? ` → ${compressSchema(resp.schema)}` : "";
      lines.push(`  ${resp.statusCode}: ${resp.description}${schemaStr}`);
    }
  }

  return lines.join("\n");
}

export interface GuideOptions {
  title: string;
  baseUrl?: string;
  apiContext: string;
  outputDir: string;
  securitySchemes: SecuritySchemeInfo[];
  endpointCount: number;
  coverageHeader?: string;
}

export function buildGenerationGuide(opts: GuideOptions): string {
  const hasAuth = opts.securitySchemes.length > 0;

  return `# Test Generation Guide for ${opts.title}
${opts.coverageHeader ? `\n${opts.coverageHeader}\n` : ""}
## API Specification (${opts.endpointCount} endpoints)
${opts.baseUrl ? `Base URL: ${opts.baseUrl}` : "Base URL: use {{base_url}} environment variable"}

${opts.apiContext}

${hasAuth ? `---

## Environment Setup (Required for Authentication)

This API uses authentication. Before running tests, set up your credentials:

### Option A — Edit the env file directly
After \`setup_api\`, the collection directory contains \`.env.default.yaml\`. Edit it to add your credentials:
\`\`\`yaml
base_url: "https://api.example.com"
api_key: "your-actual-api-key-here"
auth_token: "your-token-here"
\`\`\`

### Option B — Use \`manage_environment\`
\`\`\`
manage_environment(action: "set", name: "default", collectionName: "your-api", variables: {"api_key": "your-key"})
\`\`\`

### How it works
- Tests **automatically** load the \`"default"\` environment — no need to pass \`envName\` to \`run_tests\`
- If the env file is in the collection root and tests are in a \`tests/\` subdirectory, the file is still found automatically
- Use \`{{api_key}}\`, \`{{auth_token}}\`, \`{{base_url}}\` etc. in test headers/bodies
- **Never hardcode credentials** in YAML files — always use \`{{variable}}\` references

` : ""}---

## YAML Test Suite Format Reference

\`\`\`yaml
name: "Suite Name"
description: "What this suite tests"  # optional
tags: [smoke, crud]                   # optional — used for filtering with --tag
base_url: "{{base_url}}"
headers:                          # optional suite-level headers
  Authorization: "Bearer {{auth_token}}"
  Content-Type: "application/json"
config:                           # optional
  timeout: 30000
  retries: 0
  follow_redirects: true
tests:
  - name: "Test step name"
    POST: "/path/{{variable}}"    # exactly ONE method key: GET, POST, PUT, PATCH, DELETE
    json:                         # request body (object)
      field: "value"
    query:                        # query parameters
      limit: "10"
    headers:                      # step-level headers (override suite)
      X-Custom: "value"
    expect:
      status: 200                 # expected HTTP status (integer)
      body:                       # field-level assertions
        id: { type: "integer", capture: "item_id" }
        name: { equals: "expected" }
        email: { contains: "@", type: "string" }
        count: { gt: 0, lt: 100 }
        items: { exists: true }       # exists must be boolean, NEVER string
        pattern: { matches: "^[A-Z]+" }
      headers:
        Content-Type: "application/json"
      duration: 5000              # max response time in ms
\`\`\`

### Assertion Rules
- \`capture: "var_name"\` — SAVES the value into a variable (use in later steps as {{var_name}})
- \`equals: value\` — exact match COMPARISON (NEVER use equals to save a value!)
- \`type: "string"|"number"|"integer"|"boolean"|"array"|"object"\`
- \`contains: "substring"\` — string substring match
- \`matches: "regex"\` — regex pattern match
- \`gt: N\` / \`lt: N\` — numeric comparison
- \`exists: true|false\` — field presence check (MUST be boolean, not string)

### Nested Body Assertions
Both forms are equivalent and supported:

**Dot-notation (flat):**
\`\`\`yaml
body:
  "category.name": { equals: "Dogs" }
  "address.city": { type: "string" }
\`\`\`

**Nested YAML (auto-flattened):**
\`\`\`yaml
body:
  category:
    name: { equals: "Dogs" }
  address:
    city: { type: "string" }
\`\`\`

### Root Body Assertions (\`_body\`)
Use \`_body\` to assert on the response body itself (not a field inside it):

\`\`\`yaml
body:
  _body: { type: "array" }           # check that response body IS an array
  _body: { type: "object" }          # check that response body IS an object
  _body: { exists: true }            # check that body is not null/undefined
\`\`\`

### Built-in Generators
Use in string values: \`{{$randomInt}}\`, \`{{$uuid}}\`, \`{{$timestamp}}\`, \`{{$randomEmail}}\`, \`{{$randomString}}\`, \`{{$randomName}}\`
These are the ONLY generators — do NOT invent others.

### Variable Interpolation
- \`{{variable}}\` in paths, bodies, headers, query params
- Captured values from previous steps are available in subsequent steps
- Environment variables from .env.yaml files: \`{{base_url}}\`, \`{{auth_username}}\`, etc.

---

## Step-by-Step Generation Algorithm

### Step 0: Register the API (REQUIRED FIRST)
**Always call \`setup_api\` before generating any tests.** This registers the collection in the database so WebUI, coverage tracking, and env loading all work.
\`\`\`
setup_api(name: "myapi", specPath: "/path/to/openapi.json", dir: "/path/to/project/apis/myapi")
\`\`\`
If you skip this step, WebUI will show "No API collections registered yet" and env variables won't auto-load.

${hasAuth ? `**Then set credentials immediately after setup_api** — use \`manage_environment\` to store the API key before touching any YAML files:
\`\`\`
manage_environment(action: "set", name: "default", collectionName: "myapi", variables: {"api_key": "<actual-key>", "base_url": "https://..."})
\`\`\`
Never put actual key values in YAML files.

` : ""}\
### Step 1: Analyze the API
- Identify authentication method (${hasAuth ? opts.securitySchemes.map(s => `${s.name}: ${s.type}${s.scheme ? `/${s.scheme}` : ""}`).join(", ") : "none detected"})
- Group endpoints by resource (e.g., /users/*, /pets/*, /orders/*)
- Identify CRUD patterns: POST (create) → GET (read) → PUT/PATCH (update) → DELETE
- Note required fields in request bodies

### Step 2: Plan Test Suites
Before generating, check coverage with \`coverage_analysis\` to avoid duplicating existing tests. Use \`generate_missing_tests\` for incremental generation.

> **Coverage note**: coverage is a static scan of YAML files — an endpoint is "covered" if a test file contains a matching METHOD + path line, regardless of whether tests pass or actually run.

Create separate files for each concern:
${hasAuth ? `- \`${opts.outputDir}auth.yaml\` — Authentication flow\n` : ""}\
- \`${opts.outputDir}{resource}-crud.yaml\` — CRUD lifecycle per resource
- \`${opts.outputDir}{resource}-validation.yaml\` — Error cases per resource

### Step 3: Generate Each Suite

${hasAuth ? `**Auth suite** (\`auth.yaml\`):
1. Login with valid credentials → capture token
2. Access protected endpoint with token → 200
3. Login with invalid credentials → 401/403
4. Access protected endpoint without token → 401

` : ""}\
**CRUD lifecycle** (\`{resource}-crud.yaml\`):
1. Create resource (POST) → 201, **always verify key fields in response body** (at minimum: id, name/title)
2. Read created resource (GET /resource/{{id}}) → 200, verify fields match what was sent
3. List resources (GET /resource) → 200, verify \`_body: { type: "array" }\` AND \`_body.length: { gt: 0 }\`
4. Update resource (PUT/PATCH /resource/{{id}}) → 200
5. Read updated resource → verify changes applied
6. Delete resource (DELETE /resource/{{id}}) → 200/204
7. Verify deleted (GET /resource/{{id}}) → 404
8. For bulk create endpoints (createWithArray/List): create → then GET each to verify they exist

**Validation suite** (\`{resource}-validation.yaml\`):
1. Create with missing required fields → 400/422, verify \`message: { exists: true }\` in error body
2. Create with invalid field types → 400/422
3. Get non-existent resource (e.g. id=999999) → 404
4. Delete non-existent resource → 404
5. For error responses: always assert error body has meaningful content, not just status code

### Step 4: Save, Run, Debug
1. Use \`save_test_suite\` to save each file — it validates YAML before writing
2. Use \`run_tests\` to execute — review pass/fail summary
3. If failures: use \`query_db\` with \`action: "diagnose_failure"\` and the runId to see full request/response details
4. Fix issues and re-save with \`overwrite: true\`

---

## Tag Conventions

Use standard tags to enable safe filtering:

| Tag | HTTP Methods | Safe for |
|-----|-------------|---------|
| \`smoke\` | GET only | Production (read-only, zero risk) |
| \`crud\` | POST/PUT/PATCH | Staging only (state-changing) |
| \`destructive\` | DELETE | Explicit opt-in, run last |
| \`auth\` | Any (auth flows) | Run first to capture tokens |

Example: \`apitool run --tag smoke --safe\` → reads-only, safe against production.

---

## Practical Tips

- **int64 IDs**: For APIs returning large auto-generated IDs (int64), prefer setting fixed IDs in request bodies rather than capturing auto-generated ones, as JSON number precision may cause mismatches.
- **Nested assertions**: Use dot-notation or nested YAML — both work identically.
- **Root body type**: Use \`_body: { type: "array" }\` to verify the response body type itself.
- **List endpoints**: Always check both type AND non-emptiness: \`_body: { type: "array" }\` + \`_body.length: { gt: 0 }\`
- **Create responses**: Always verify at least the key identifying fields (id, name) in the response body — don't just check status.
- **Error responses**: Assert that error bodies contain useful info (\`message: { exists: true }\`), not just status codes.
- **Bulk operations**: After bulk create (createWithArray, createWithList), add GET steps to verify resources were actually created.
- **204 No Content**: When an endpoint returns 204, omit \`body:\` assertions entirely — an empty response IS the correct behavior. Adding body assertions on 204 will always fail.
- **Cleanup pattern**: Always delete test data in the same suite. Use a create → read → delete lifecycle so tests are idempotent:
  \`\`\`yaml
  tests:
    - name: Create test resource
      POST: /users
      json: { name: "apitool-test-{{$randomString}}" }
      expect:
        status: 201
        body:
          id: { capture: user_id }
    - name: Read created resource
      GET: /users/{{user_id}}
      expect:
        status: 200
    - name: Cleanup - delete test resource
      DELETE: /users/{{user_id}}
      expect:
        status: 204
  \`\`\`
- **Identifiable test data**: Prefix test data with \`apitool-test-\` or use \`{{$uuid}}\` / \`apitool-test-{{$randomString}}\` so you can identify and clean up leftover test data if needed.

---

## Common Mistakes to Avoid

1. **equals vs capture**: \`capture\` SAVES a value, \`equals\` COMPARES. To extract a token: \`{ capture: "token" }\` NOT \`{ equals: "{{token}}" }\`
2. **exists must be boolean**: \`exists: true\` NOT \`exists: "true"\`
3. **Status must be integer**: \`status: 200\` NOT \`status: "200"\`
4. **One method per step**: Each test step has exactly ONE of GET/POST/PUT/PATCH/DELETE
5. **Don't hardcode base URL**: Use \`{{base_url}}\` — set it in environment or suite base_url
6. **Auth credentials**: Use environment variables \`{{auth_username}}\`, \`{{auth_password}}\` — NOT generators
7. **String query params**: Query parameter values must be strings: \`limit: "10"\` not \`limit: 10\`
8. **Hardcoded credentials**: NEVER put actual API keys/tokens in YAML — use \`{{api_key}}\` from env instead
9. **Body assertions on 204**: Don't add \`body:\` checks for DELETE or other endpoints that return 204 No Content — the body is empty by design.

---

## Tools to Use

| Tool | When |
|------|------|
| \`setup_api\` | Register a new API (creates dirs, reads spec, sets up env) |
| \`generate_tests_guide\` | Get this guide for full API spec |
| \`generate_missing_tests\` | Get guide for only uncovered endpoints |
| \`save_test_suite\` | Save generated YAML (validates before writing) |
| \`run_tests\` | Execute saved test suites |
| \`query_db\` | Query runs, collections, results, diagnose failures |
| \`coverage_analysis\` | Find untested endpoints for incremental generation |
| \`explore_api\` | Re-check specific endpoints (use includeSchemas=true) |
| \`ci_init\` | Generate CI/CD workflow (GitHub Actions / GitLab CI) to run tests on push |

## Workflow After Tests Pass

After tests are saved and running successfully, ask the user if they want to set up CI/CD:
1. Use \`ci_init\` to generate a CI workflow (auto-detects platform or use platform param)
2. Help them commit and push to their repository
3. Tests will run automatically on push, PR, and on schedule
`;
}

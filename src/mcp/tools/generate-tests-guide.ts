import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../core/generator/index.ts";
import type { EndpointInfo, SecuritySchemeInfo } from "../../core/generator/types.ts";
import { compressSchema, formatParam } from "../../core/generator/schema-utils.ts";

export function registerGenerateTestsGuideTool(server: McpServer) {
  server.registerTool("generate_tests_guide", {
    description: "Get a comprehensive guide for generating API test suites. " +
      "Returns the full API specification (with request/response schemas) and a step-by-step algorithm " +
      "for creating YAML test files. Use this BEFORE generating tests — it gives you " +
      "everything you need to write high-quality test suites. " +
      "After generating, use save_test_suite to save, run_tests to execute, and diagnose_failure to debug.",
    inputSchema: {
      specPath: z.string().describe("Path or URL to OpenAPI spec file"),
      outputDir: z.optional(z.string()).describe("Directory for saving test files (default: ./tests/)"),
    },
  }, async ({ specPath, outputDir }) => {
    try {
      const doc = await readOpenApiSpec(specPath);
      const endpoints = extractEndpoints(doc);
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

function compressEndpointsWithSchemas(
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
      lines.push(`  Request body (${contentType}): ${compressSchema(ep.requestBodySchema)}`);
    }

    // Responses with schemas
    for (const resp of ep.responses) {
      const schemaStr = resp.schema ? ` → ${compressSchema(resp.schema)}` : "";
      lines.push(`  ${resp.statusCode}: ${resp.description}${schemaStr}`);
    }
  }

  return lines.join("\n");
}

interface GuideOptions {
  title: string;
  baseUrl?: string;
  apiContext: string;
  outputDir: string;
  securitySchemes: SecuritySchemeInfo[];
  endpointCount: number;
}

function buildGenerationGuide(opts: GuideOptions): string {
  const hasAuth = opts.securitySchemes.length > 0;

  return `# Test Generation Guide for ${opts.title}

## API Specification (${opts.endpointCount} endpoints)
${opts.baseUrl ? `Base URL: ${opts.baseUrl}` : "Base URL: use {{base_url}} environment variable"}

${opts.apiContext}

---

## YAML Test Suite Format Reference

\`\`\`yaml
name: "Suite Name"
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

### Built-in Generators
Use in string values: \`{{$randomInt}}\`, \`{{$uuid}}\`, \`{{$timestamp}}\`, \`{{$randomEmail}}\`, \`{{$randomString}}\`, \`{{$randomName}}\`
These are the ONLY generators — do NOT invent others.

### Variable Interpolation
- \`{{variable}}\` in paths, bodies, headers, query params
- Captured values from previous steps are available in subsequent steps
- Environment variables from .env.yaml files: \`{{base_url}}\`, \`{{auth_username}}\`, etc.

---

## Step-by-Step Generation Algorithm

### Step 1: Analyze the API
- Identify authentication method (${hasAuth ? opts.securitySchemes.map(s => `${s.name}: ${s.type}${s.scheme ? `/${s.scheme}` : ""}`).join(", ") : "none detected"})
- Group endpoints by resource (e.g., /users/*, /pets/*, /orders/*)
- Identify CRUD patterns: POST (create) → GET (read) → PUT/PATCH (update) → DELETE
- Note required fields in request bodies

### Step 2: Plan Test Suites
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
1. Create resource (POST) → 201, capture \`id\`
2. Read created resource (GET /resource/{{id}}) → 200, verify fields
3. Update resource (PUT/PATCH /resource/{{id}}) → 200
4. Read updated resource → verify changes
5. Delete resource (DELETE /resource/{{id}}) → 200/204
6. Verify deleted (GET /resource/{{id}}) → 404

**Validation suite** (\`{resource}-validation.yaml\`):
1. Create with missing required fields → 400/422
2. Create with invalid field types → 400/422
3. Get non-existent resource (e.g. id=999999) → 404
4. Delete non-existent resource → 404

### Step 4: Save, Run, Debug
1. Use \`save_test_suite\` to save each file — it validates YAML before writing
2. Use \`run_tests\` to execute — review pass/fail summary
3. If failures: use \`diagnose_failure\` with the runId to see full request/response details
4. Fix issues and re-save with \`overwrite: true\`

---

## Common Mistakes to Avoid

1. **equals vs capture**: \`capture\` SAVES a value, \`equals\` COMPARES. To extract a token: \`{ capture: "token" }\` NOT \`{ equals: "{{token}}" }\`
2. **exists must be boolean**: \`exists: true\` NOT \`exists: "true"\`
3. **Status must be integer**: \`status: 200\` NOT \`status: "200"\`
4. **One method per step**: Each test step has exactly ONE of GET/POST/PUT/PATCH/DELETE
5. **Don't hardcode base URL**: Use \`{{base_url}}\` — set it in environment or suite base_url
6. **Auth credentials**: Use environment variables \`{{auth_username}}\`, \`{{auth_password}}\` — NOT generators
7. **String query params**: Query parameter values must be strings: \`limit: "10"\` not \`limit: 10\`

---

## Tools to Use

| Tool | When |
|------|------|
| \`save_test_suite\` | Save generated YAML (validates before writing) |
| \`run_tests\` | Execute saved test suites |
| \`diagnose_failure\` | Analyze failures with full request/response details |
| \`coverage_analysis\` | Find untested endpoints for incremental generation |
| \`explore_api\` | Re-check specific endpoints (use includeSchemas=true) |
`;
}

import type { EndpointInfo, SecuritySchemeInfo } from "./types.ts";
import { compressSchema, formatParam, isAnySchema } from "./schema-utils.ts";

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

const YAML_FORMAT_CHEATSHEET = `
## YAML Test Format Reference

### Suite structure
\`\`\`yaml
name: Suite Name          # required
base_url: "{{base_url}}"  # or hardcoded URL
tags: [smoke]             # optional: smoke | crud | destructive | auth
tests:
  - name: Get all items   # required
    GET: /items            # method as YAML key, path as value
    query: { limit: 10 }
    expect:
      status: 200
      _body: { type: array, length_gt: 0 }
\`\`\`

### Path parameters
Inline the value directly — there is NO \`params\` field:
\`\`\`yaml
  - name: Get item by ID
    GET: /items/1              # hardcoded
  - name: Get captured item
    GET: /items/{{item_id}}    # from prior capture
\`\`\`

### Assertion operators (use inside expect)
| Operator | Example |
|----------|---------|
| equals (default) | \`status: 200\` |
| not_equals | \`status: { not_equals: 500 }\` |
| contains | \`name: { contains: "john" }\` |
| not_contains | \`error: { not_contains: "fatal" }\` |
| exists / not_exists | \`id: { exists: true }\` |
| gt / gte / lt / lte | \`count: { gte: 1 }\` |
| matches (regex) | \`email: { matches: "^.+@.+$" }\` |
| type | \`items: { type: array }\` |
| length | \`items: { length: 5 }\` |
| length_gt/gte/lt/lte | \`items: { length_gt: 0 }\` |

### Body assertions
- \`_body\` — assert on root response body: \`_body: { type: array }\`
- Combine operators in one key: \`_body: { type: array, length_gt: 0 }\`
- Dot-notation for nested: \`data.user.id: { exists: true }\`
- Array element: \`items.0.name: { exists: true }\`
- YAML keys must be unique — do NOT repeat \`_body\` twice

### Request body — IMPORTANT
Use \`json:\` for JSON request bodies. Do NOT use \`body:\` — it is not a valid key.
\`\`\`yaml
  - name: Create resource
    POST: /resources
    json: { name: "test", email: "a@b.com" }   # correct — use json:
    # body: { ... }                              # WRONG — body: is not supported
    expect:
      status: 201
      id: { exists: true }
\`\`\`
For form-encoded: use \`form:\` instead of \`json:\`.

### Built-in generators
\`{{$uuid}}\`, \`{{$randomInt}}\`, \`{{$timestamp}}\`, \`{{$randomName}}\`, \`{{$randomEmail}}\`, \`{{$randomString}}\`

### Variable capture & interpolation
\`\`\`yaml
  - name: Create item
    POST: /items
    json: { name: "test-{{$uuid}}" }
    capture:
      created_id: id        # saves response.id
    expect:
      status: 201

  - name: Get created item
    GET: /items/{{created_id}}
    expect:
      status: 200
      id: { equals: "{{created_id}}" }
\`\`\`

### Coverage matching
Use spec paths with \`{param}\` placeholders in the path for coverage to match:
- Spec says \`GET /products/{id}\` → write \`GET: /products/1\` (hardcode the value)
- Coverage scanner matches test paths against spec paths automatically
`;

export interface GuideOptions {
  title: string;
  baseUrl?: string;
  apiContext: string;
  outputDir: string;
  securitySchemes: SecuritySchemeInfo[];
  endpointCount: number;
  coverageHeader?: string;
  includeFormat?: boolean;
}

export function buildGenerationGuide(opts: GuideOptions): string {
  const hasAuth = opts.securitySchemes.length > 0;

  const securitySummary = hasAuth
    ? `Security: ${opts.securitySchemes.map(s => `${s.name} (${s.type}${s.scheme ? `/${s.scheme}` : ""})`).join(", ")}`
    : "Security: none";

  const formatSection = opts.includeFormat !== false ? YAML_FORMAT_CHEATSHEET : "";

  return `# Test Generation Guide for ${opts.title}
${opts.coverageHeader ? `\n${opts.coverageHeader}\n` : ""}
## API Specification (${opts.endpointCount} endpoints)
${opts.baseUrl ? `Base URL: ${opts.baseUrl}` : "Base URL: use {{base_url}} environment variable"}
${securitySummary}

${opts.apiContext}${formatSection}`;
}

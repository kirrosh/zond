import type { EndpointInfo, SecuritySchemeInfo } from "../types.ts";
import type { ChatMessage } from "./llm-client.ts";
import type { OpenAPIV3 } from "openapi-types";

const SYSTEM_PROMPT = `You are an API test generator. You produce JSON output that represents test suites for an API testing tool.

OUTPUT FORMAT — return a JSON object with a single key "suites" containing an array of suite objects:
{
  "suites": [
    {
      "name": "Suite Name",
      "base_url": "{{base_url}}",
      "headers": {
        "Authorization": "Bearer {{auth_token}}"
      },
      "tests": [
        {
          "name": "Authenticate",
          "POST": "/auth/login",
          "json": { "username": "{{auth_username}}", "password": "{{auth_password}}" },
          "expect": {
            "status": 200,
            "body": {
              "token": { "type": "string", "capture": "auth_token" }
            }
          }
        },
        {
          "name": "Create item",
          "POST": "/items",
          "json": { "name": "{{$randomString}}" },
          "expect": {
            "status": 201,
            "body": {
              "id": { "type": "number", "capture": "created_id" }
            }
          }
        },
        {
          "name": "Verify created",
          "GET": "/items/{{created_id}}",
          "expect": {
            "status": 200,
            "body": {
              "id": { "equals": "{{created_id}}" }
            }
          }
        }
      ]
    }
  ]
}

RULES:
1. Each test step has exactly ONE HTTP method key: GET, POST, PUT, PATCH, or DELETE. The value is the path.
2. Use "json" for request bodies (objects). Use "form" for form data. Use "query" for query parameters.
3. "expect" contains "status" (number) and optional "body" with field assertions.
4. Body assertions are objects with these optional keys:
   - "type": "string" | "number" | "integer" | "boolean" | "array" | "object"
   - "equals": exact value match
   - "contains": substring match (strings)
   - "matches": regex pattern
   - "gt": greater than (numbers)
   - "lt": less than (numbers)
   - "exists": true (must be boolean true, NEVER a string)
   - "capture": variable name — SAVES the response value into a variable for later steps
5. Use {{variable}} syntax to reference captured values in paths, bodies, and assertions.
6. ONLY these built-in generators exist: {{$randomInt}}, {{$uuid}}, {{$timestamp}}, {{$randomEmail}}, {{$randomString}}, {{$randomName}}. Do NOT invent others like $randomString(N) or $randomWord — they do not exist.
7. Use {{base_url}} for the base URL — never hardcode it.
8. Steps execute sequentially — a capture in step 1 is available in step 2+.
9. Generate realistic test data. Use generators for uniqueness where needed.
10. Output ONLY the JSON object, no markdown fences or extra text.

CRITICAL — common mistakes to avoid:
- NEVER use "equals" to save a value. "equals" COMPARES, "capture" SAVES. To extract a token: {"capture": "auth_token"} NOT {"equals": "{{auth_token}}"}.
- NEVER prefix double braces with a dollar sign. Correct: {{my_var}}. Wrong: $` + `{{my_var}}. Generators also use plain braces: {{$randomString}} not $` + `{{$randomString}}.
- If the API has authentication (JWT, Bearer token), ALWAYS add a login step FIRST that captures the token, then set suite-level "headers": {"Authorization": "Bearer {{auth_token}}"}.
- For login credentials, use environment variables {{auth_username}} and {{auth_password}}, NOT generators like {{$randomEmail}}.
- "exists" value MUST be boolean true or false, NEVER the string "true".`;

export function buildMessages(
  endpoints: EndpointInfo[],
  securitySchemes: SecuritySchemeInfo[],
  userPrompt: string,
  baseUrl?: string,
): ChatMessage[] {
  const apiContext = compressEndpoints(endpoints, securitySchemes);

  const userMessage = `API SPECIFICATION:
${apiContext}
${baseUrl ? `\nBase URL: ${baseUrl}` : ""}

USER REQUEST:
${userPrompt}

Generate test suites as JSON following the rules in your instructions.`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];
}

function compressEndpoints(
  endpoints: EndpointInfo[],
  securitySchemes: SecuritySchemeInfo[],
): string {
  const lines: string[] = [];

  // Security schemes
  if (securitySchemes.length > 0) {
    lines.push("SECURITY:");
    for (const s of securitySchemes) {
      let desc = `  ${s.name}: ${s.type}`;
      if (s.scheme) desc += ` (${s.scheme})`;
      if (s.in && s.apiKeyName) desc += ` (${s.apiKeyName} in ${s.in})`;
      lines.push(desc);
    }
    lines.push("");
  }

  // Endpoints
  lines.push("ENDPOINTS:");
  for (const ep of endpoints) {
    const summary = ep.summary ? ` — ${ep.summary}` : "";
    const security = ep.security.length > 0 ? `  [auth: ${ep.security.join(", ")}]` : "";
    lines.push(`${ep.method} ${ep.path}${summary}${security}`);

    // Parameters
    const pathParams = ep.parameters.filter((p) => p.in === "path");
    const queryParams = ep.parameters.filter((p) => p.in === "query");
    if (pathParams.length > 0) {
      lines.push(`  Path params: ${pathParams.map((p) => formatParam(p)).join(", ")}`);
    }
    if (queryParams.length > 0) {
      lines.push(`  Query params: ${queryParams.map((p) => formatParam(p)).join(", ")}`);
    }

    // Request body
    if (ep.requestBodySchema) {
      lines.push(`  Body: ${compressSchema(ep.requestBodySchema)}`);
    }

    // Responses
    for (const resp of ep.responses) {
      const schemaStr = resp.schema ? ` ${compressSchema(resp.schema)}` : "";
      lines.push(`  ${resp.statusCode}: ${resp.description}${schemaStr}`);
    }
  }

  return lines.join("\n");
}

function formatParam(p: OpenAPIV3.ParameterObject): string {
  const schema = p.schema as OpenAPIV3.SchemaObject | undefined;
  const type = schema?.type ?? "string";
  const req = p.required ? " (req)" : "";
  return `${p.name}: ${type}${req}`;
}

function compressSchema(schema: OpenAPIV3.SchemaObject, depth = 0): string {
  if (depth > 2) return "{...}";

  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(schema.properties).map(([key, propObj]) => {
      const prop = propObj as OpenAPIV3.SchemaObject;
      const type = prop.type ?? "any";
      const flags: string[] = [];
      if (required.has(key)) flags.push("req");
      if (prop.format) flags.push(prop.format);
      if (prop.enum) flags.push(`enum: ${prop.enum.join("|")}`);
      const flagStr = flags.length > 0 ? ` (${flags.join(", ")})` : "";
      return `${key}: ${type}${flagStr}`;
    });
    return `{ ${fields.join(", ")} }`;
  }

  if (schema.type === "array") {
    const items = schema.items as OpenAPIV3.SchemaObject | undefined;
    if (items) return `[${compressSchema(items, depth + 1)}]`;
    return "[]";
  }

  return schema.type ?? "any";
}

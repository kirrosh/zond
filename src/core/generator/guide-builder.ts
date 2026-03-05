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

  const securitySummary = hasAuth
    ? `Security: ${opts.securitySchemes.map(s => `${s.name} (${s.type}${s.scheme ? `/${s.scheme}` : ""})`).join(", ")}`
    : "Security: none";

  return `# Test Generation Guide for ${opts.title}
${opts.coverageHeader ? `\n${opts.coverageHeader}\n` : ""}
## API Specification (${opts.endpointCount} endpoints)
${opts.baseUrl ? `Base URL: ${opts.baseUrl}` : "Base URL: use {{base_url}} environment variable"}
${securitySummary}

${opts.apiContext}`;
}

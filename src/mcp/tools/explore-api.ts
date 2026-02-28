import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../core/generator/index.ts";

export function registerExploreApiTool(server: McpServer) {
  server.registerTool("explore_api", {
    description: "Explore an OpenAPI spec — list endpoints, servers, and security schemes. Optionally filter by tag.",
    inputSchema: {
      specPath: z.string().describe("Path to OpenAPI spec file (JSON or YAML)"),
      tag: z.optional(z.string()).describe("Filter endpoints by tag"),
    },
  }, async ({ specPath, tag }) => {
    try {
      const doc = await readOpenApiSpec(specPath);
      const allEndpoints = extractEndpoints(doc);
      const securitySchemes = extractSecuritySchemes(doc);
      const servers = ((doc as any).servers ?? []) as Array<{ url: string; description?: string }>;

      const endpoints = tag
        ? allEndpoints.filter(ep => ep.tags.includes(tag))
        : allEndpoints;

      const result = {
        title: (doc as any).info?.title,
        version: (doc as any).info?.version,
        servers: servers.map(s => ({ url: s.url, description: s.description })),
        securitySchemes: securitySchemes.map(s => ({
          name: s.name,
          type: s.type,
          ...(s.scheme ? { scheme: s.scheme } : {}),
          ...(s.in ? { in: s.in, keyName: s.apiKeyName } : {}),
        })),
        totalEndpoints: allEndpoints.length,
        ...(tag ? { filteredByTag: tag, matchingEndpoints: endpoints.length } : {}),
        endpoints: endpoints.map(ep => ({
          method: ep.method,
          path: ep.path,
          summary: ep.summary,
          tags: ep.tags,
          parameters: ep.parameters.map(p => ({
            name: p.name,
            in: p.in,
            required: p.required ?? false,
          })),
          hasRequestBody: !!ep.requestBodySchema,
          responses: ep.responses.map(r => ({
            statusCode: r.statusCode,
            description: r.description,
          })),
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }],
        isError: true,
      };
    }
  });
}

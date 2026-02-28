import { tool } from "ai";
import { z } from "zod";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../generator/index.ts";

export const exploreApiTool = tool({
  description: "Explore an OpenAPI spec — list endpoints with method, path, and summary. Optionally filter by tag.",
  inputSchema: z.object({
    specPath: z.string().describe("Path to OpenAPI spec file (JSON or YAML)"),
    tag: z.string().optional().describe("Filter endpoints by tag"),
  }),
  execute: async (args) => {
    try {
      const doc = await readOpenApiSpec(args.specPath);
      const allEndpoints = extractEndpoints(doc);
      const securitySchemes = extractSecuritySchemes(doc);
      const servers = ((doc as any).servers ?? []) as Array<{ url: string }>;

      const endpoints = args.tag
        ? allEndpoints.filter(ep => ep.tags.includes(args.tag!))
        : allEndpoints;

      // Compact output — method + path + summary only
      return {
        title: (doc as any).info?.title,
        version: (doc as any).info?.version,
        servers: servers.map(s => s.url),
        securitySchemes: securitySchemes.map(s => s.name),
        totalEndpoints: allEndpoints.length,
        ...(args.tag ? { filteredByTag: args.tag, matchingEndpoints: endpoints.length } : {}),
        endpoints: endpoints.map(ep => ({
          method: ep.method,
          path: ep.path,
          summary: ep.summary,
        })),
      };
    } catch (err) {
      return { error: (err as Error).message };
    }
  },
});

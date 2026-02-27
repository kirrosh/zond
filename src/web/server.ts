import { OpenAPIHono } from "@hono/zod-openapi";
import { getDb } from "../db/schema.ts";
import dashboard from "./routes/dashboard.ts";
import runs from "./routes/runs.ts";
import api from "./routes/api.ts";
import collections from "./routes/collections.ts";
import aiGenerate from "./routes/ai-generate.ts";
import environments from "./routes/environments.ts";
import { createExplorerRoute, type ExplorerDeps, type ServerInfo } from "./routes/explorer.ts";
import type { EndpointInfo } from "../core/generator/types.ts";
import styleCssPath from "./static/style.css" with { type: "file" };
import { resolve, dirname } from "path";
const htmxJsPath = resolve(dirname(new URL(import.meta.url).pathname), "static/htmx.min.js");

export interface ServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  openapiSpec?: string;
}

export function createApp(explorerDeps: ExplorerDeps) {
  const app = new OpenAPIHono();

  // Static files
  app.get("/static/:file", async (c) => {
    const file = c.req.param("file");
    // Only serve known files, prevent path traversal
    if (file === "style.css") {
      const content = await Bun.file(styleCssPath).text();
      c.header("Content-Type", "text/css; charset=utf-8");
      c.header("Cache-Control", "public, max-age=3600");
      return c.body(content);
    }
    if (file === "htmx.min.js") {
      const content = await Bun.file(htmxJsPath).text();
      c.header("Content-Type", "application/javascript; charset=utf-8");
      c.header("Cache-Control", "public, max-age=86400");
      return c.body(content);
    }
    return c.notFound();
  });

  // Mount routes
  app.route("/", dashboard);
  app.route("/", runs);
  app.route("/", api);
  app.route("/", collections);
  app.route("/", aiGenerate);
  app.route("/", environments);
  app.route("/", createExplorerRoute(explorerDeps));

  // OpenAPI spec endpoint — derive server URL from the incoming request
  app.doc("/api/openapi.json", (c) => ({
    openapi: "3.0.0",
    info: {
      title: "apitool API",
      version: "0.1.0",
      description: "API testing platform — self-documented API",
    },
    servers: [
      {
        url: new URL(c.req.url).origin,
        description: "Current server",
      },
    ],
  }));

  return app;
}

export async function startServer(options: ServerOptions = {}): Promise<void> {
  const port = options.port ?? 8080;
  const host = options.host ?? "0.0.0.0";

  // Initialize DB
  getDb(options.dbPath);

  // Load OpenAPI spec if provided
  let endpoints: EndpointInfo[] = [];
  let servers: ServerInfo[] = [];
  let securitySchemes: import("../core/generator/types.ts").SecuritySchemeInfo[] = [];
  let loginPath: string | null = null;
  let specPath: string | null = options.openapiSpec ?? null;

  // Auto-detect spec from collections if not provided
  if (!specPath) {
    try {
      const { listCollections } = await import("../db/queries.ts");
      const cols = listCollections();
      const withSpec = cols.find((c) => c.openapi_spec);
      if (withSpec?.openapi_spec) {
        specPath = withSpec.openapi_spec;
      }
    } catch { /* DB not critical */ }
  }

  if (specPath) {
    try {
      const { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } = await import("../core/generator/openapi-reader.ts");
      const doc = await readOpenApiSpec(specPath);
      endpoints = extractEndpoints(doc);
      securitySchemes = extractSecuritySchemes(doc);
      // Extract servers from spec (like Swagger UI does)
      if (doc.servers && Array.isArray(doc.servers)) {
        servers = doc.servers.map((s: any) => ({
          url: (s.url ?? "").replace(/\/+$/, ""),
          description: s.description,
        }));
      }

      // If all servers are relative URLs, try to resolve using environment base_url
      const allRelative = servers.length > 0 && servers.every(s => !s.url.startsWith("http"));
      if (allRelative) {
        try {
          const { listCollections, getEnvironment } = await import("../db/queries.ts");
          const { sanitizeEnvName } = await import("../core/generator/skeleton.ts");
          const specTitle = (doc as any).info?.title;
          // Try environment matching spec title
          const envName = specTitle ? sanitizeEnvName(specTitle) : null;
          const env = envName ? getEnvironment(envName) : null;
          if (env?.base_url) {
            const envBase = env.base_url.replace(/\/+$/, "");
            // If env base_url is also relative, keep as-is
            if (envBase.startsWith("http")) {
              servers = servers.map(s => ({
                url: envBase,
                description: s.description ?? "From environment",
              }));
            }
          }
        } catch { /* DB not critical */ }
      }
      // Auto-detect login endpoint: POST, path contains /auth or /login or /token, no security
      const loginEndpoint = endpoints.find((ep) => {
        if (ep.method !== "POST") return false;
        if (ep.security.length > 0) return false;
        return /\/(auth|login|token)/i.test(ep.path);
      });
      if (loginEndpoint) loginPath = loginEndpoint.path;
    } catch (err) {
      console.error(`Warning: failed to load OpenAPI spec: ${(err as Error).message}`);
      specPath = null;
    }
  }

  const app = createApp({ endpoints, specPath, servers, securitySchemes, loginPath });

  const { getRuntimeInfo } = await import("../cli/runtime.ts");
  console.log(`apitool server (${getRuntimeInfo()}) running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);

  Bun.serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });
}

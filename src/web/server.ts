import { Hono } from "hono";
import { getDb } from "../db/schema.ts";
import dashboard from "./routes/dashboard.ts";
import runs from "./routes/runs.ts";
import api from "./routes/api.ts";
import { createExplorerRoute, type ExplorerDeps, type ServerInfo } from "./routes/explorer.ts";
import type { EndpointInfo } from "../core/generator/types.ts";

export interface ServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  openapiSpec?: string;
}

const STATIC_DIR = `${import.meta.dirname ?? "."}/static`;

export function createApp(explorerDeps: ExplorerDeps) {
  const app = new Hono();

  // Static files
  app.get("/static/:file", async (c) => {
    const file = c.req.param("file");
    // Only serve known files, prevent path traversal
    if (file !== "style.css") return c.notFound();
    const bunFile = Bun.file(`${STATIC_DIR}/${file}`);
    if (!(await bunFile.exists())) return c.notFound();
    const content = await bunFile.text();
    c.header("Content-Type", "text/css; charset=utf-8");
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(content);
  });

  // Mount routes
  app.route("/", dashboard);
  app.route("/", runs);
  app.route("/", api);
  app.route("/", createExplorerRoute(explorerDeps));

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

  console.log(`apitool server running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);

  Bun.serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });
}

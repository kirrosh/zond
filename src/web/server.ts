import { Hono } from "hono";
import { getDb } from "../db/schema.ts";
import dashboard from "./routes/dashboard.ts";
import runs from "./routes/runs.ts";
import api from "./routes/api.ts";
import { createExplorerRoute, type ExplorerDeps, type ServerInfo } from "./routes/explorer.ts";
import type { EndpointInfo } from "../core/generator/types.ts";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface ServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  openapiSpec?: string;
}

const STATIC_DIR = resolve(import.meta.dirname ?? ".", "static");

export function createApp(explorerDeps: ExplorerDeps) {
  const app = new Hono();

  // Static files
  app.get("/static/:file", async (c) => {
    const file = c.req.param("file");
    // Only serve known files, prevent path traversal
    if (file !== "style.css") return c.notFound();
    const filePath = resolve(STATIC_DIR, file);
    try {
      const content = await readFile(filePath, "utf-8");
      c.header("Content-Type", "text/css; charset=utf-8");
      c.header("Cache-Control", "public, max-age=3600");
      return c.body(content);
    } catch {
      return c.notFound();
    }
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
  let specPath: string | null = options.openapiSpec ?? null;
  if (specPath) {
    try {
      const { readOpenApiSpec, extractEndpoints } = await import("../core/generator/openapi-reader.ts");
      const doc = await readOpenApiSpec(specPath);
      endpoints = extractEndpoints(doc);
      // Extract servers from spec (like Swagger UI does)
      if (doc.servers && Array.isArray(doc.servers)) {
        servers = doc.servers.map((s: any) => ({
          url: (s.url ?? "").replace(/\/+$/, ""),
          description: s.description,
        }));
      }
    } catch (err) {
      console.error(`Warning: failed to load OpenAPI spec: ${(err as Error).message}`);
      specPath = null;
    }
  }

  const app = createApp({ endpoints, specPath, servers });

  console.log(`apitool server running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);

  Bun.serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });
}

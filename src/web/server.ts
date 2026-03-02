import { OpenAPIHono } from "@hono/zod-openapi";
import { getDb } from "../db/schema.ts";
import dashboard from "./routes/dashboard.ts";
import runs from "./routes/runs.ts";
import api from "./routes/api.ts";
import styleCssPath from "./static/style.css" with { type: "file" };
import htmxJsPath from "./static/htmx.min.js" with { type: "file" };

export interface ServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  dev?: boolean;
}

// SSE clients for dev hot reload
let devClients: ReadableStreamDefaultController[] = [];

export function notifyDevReload() {
  for (const ctrl of devClients) {
    try { ctrl.enqueue("data: reload\n\n"); } catch { /* client gone */ }
  }
}

export function createApp(options?: { dev?: boolean }) {
  const app = new OpenAPIHono();

  // Dev hot reload SSE endpoint
  if (options?.dev) {
    app.get("/dev/reload", (c) => {
      const stream = new ReadableStream({
        start(controller) {
          devClients.push(controller);
          controller.enqueue("data: connected\n\n");
        },
        cancel() {
          devClients = devClients.filter((c) => c !== arguments[0]);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    });
  }

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

  // Enable dev mode in layout
  if (options.dev) {
    const { setDevMode } = await import("./views/layout.ts");
    setDevMode(true);
  }

  const app = createApp({ dev: options.dev });

  const { getRuntimeInfo } = await import("../cli/runtime.ts");
  const devLabel = options.dev ? " [dev]" : "";
  console.log(`apitool server (${getRuntimeInfo()}) running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}${devLabel}`);

  Bun.serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });

  // File watcher for dev hot reload
  if (options.dev) {
    const { watch } = await import("fs");
    const { dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const webDir = dirname(fileURLToPath(import.meta.url));

    console.log(`Watching ${webDir} for changes...`);
    watch(webDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const ext = filename.split(".").pop();
      if (!["ts", "css", "html", "js"].includes(ext ?? "")) return;
      console.log(`[dev] changed: ${filename}`);
      notifyDevReload();
    });
  }
}

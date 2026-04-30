// TASK-95 spike — production migration tracked separately
import { Hono } from "hono";

export interface ServeV2Options {
  port?: number;
  host?: string;
}

export function createApp() {
  const app = new Hono();

  app.get("/api/hello", (c) =>
    c.json({
      message: "hello from zond v2 spike",
      bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
      ts: new Date().toISOString(),
    }),
  );

  return app;
}

export async function startDevServer(options: ServeV2Options = {}) {
  const port = options.port ?? 6421;
  const hostname = options.host ?? "localhost";

  const indexHtml = await import("../client/index.html");
  const app = createApp();

  const server = Bun.serve({
    port,
    hostname,
    development: true,
    routes: {
      "/api/*": (req) => app.fetch(req),
      "/": indexHtml.default,
      "/*": indexHtml.default,
    },
  });

  console.log(`[zond v2 dev] listening on http://${hostname}:${server.port}`);
  return server;
}

if (import.meta.main) {
  await startDevServer();
}

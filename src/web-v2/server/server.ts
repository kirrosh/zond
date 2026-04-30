// TASK-95 spike — production migration tracked separately
import { Hono } from "hono";
import { countRuns, getResultsByRunId, getRunById, listRuns } from "../../db/queries.ts";

export interface ServeV2Options {
  port?: number;
  host?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function createApp() {
  const app = new Hono();

  app.get("/api/hello", (c) =>
    c.json({
      message: "hello from zond v2 spike",
      bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
      ts: new Date().toISOString(),
    }),
  );

  app.get("/api/runs", (c) => {
    const limitRaw = Number(c.req.query("limit") ?? DEFAULT_LIMIT);
    const offsetRaw = Number(c.req.query("offset") ?? 0);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), MAX_LIMIT) : DEFAULT_LIMIT;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
    const status = c.req.query("status");
    const dbStatus = status === "passed" ? "all_passed"
      : status === "failed" ? "has_failures"
      : undefined;
    const filters = dbStatus ? { status: dbStatus } : undefined;
    try {
      const runs = listRuns(limit, offset, filters);
      const total = countRuns(filters);
      return c.json({ runs, total, limit, offset });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.get("/api/runs/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) {
      return c.json({ error: "invalid run id" }, 400);
    }
    try {
      const run = getRunById(id);
      if (!run) return c.json({ error: "run not found" }, 404);
      const results = getResultsByRunId(id);
      return c.json({ run, results });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  return app;
}

export async function startDevServer(options: ServeV2Options = {}) {
  const port = options.port ?? 6421;
  const hostname = options.host ?? "localhost";

  // bunfig.toml has `[serve.static] plugins = ["bun-plugin-tailwind"]`,
  // so Bun.serve transparently runs the Tailwind plugin on the HTML route.
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

import { Hono } from "hono";
import { getDb } from "../../db/schema.ts";
import { countRuns, getResultsByRunId, getRunById, listRuns } from "../../db/queries.ts";

export interface ServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  /** When true, serve the dev bundle (HTML import + bun-plugin-tailwind via bunfig). */
  dev?: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function createApp() {
  const app = new Hono();

  app.get("/api/hello", (c) =>
    c.json({
      message: "hello from zond ui",
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

  app.get("/api/runs/:id/stream", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid run id" }, 400);
    const run = getRunById(id);
    if (!run) return c.json({ error: "run not found" }, 404);

    // Stub: emits a synthetic ramp-up so the UI wiring is observable on already-finished
    // local runs. Real runner progress streaming arrives with TASK-104.
    const total = Math.max(run.total, 1);
    const stepMs = total > 50 ? 100 : 350;

    let tick: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const send = (event: string, payload: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
          } catch {
            closed = true;
            if (tick) clearInterval(tick);
          }
        };
        let completed = 0;
        send("snapshot", { runId: id, completed, total, status: "running" });
        tick = setInterval(() => {
          if (closed) return;
          completed = Math.min(completed + 1, total);
          send("progress", { runId: id, completed, total });
          if (completed >= total) {
            send("done", { runId: id });
            closed = true;
            if (tick) clearInterval(tick);
            try { controller.close(); } catch { /* already closed */ }
          }
        }, stepMs);
      },
      cancel() {
        closed = true;
        if (tick) clearInterval(tick);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
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

async function startDev(api: ReturnType<typeof createApp>, port: number, hostname: string) {
  // bunfig.toml has `[serve.static] plugins = ["bun-plugin-tailwind"]`,
  // so Bun.serve transparently runs the Tailwind plugin on the HTML route.
  const indexHtml = await import("../client/index.html");
  return Bun.serve({
    port,
    hostname,
    development: true,
    // SSE streams can run longer than Bun's default 10s idle timeout.
    idleTimeout: 255,
    routes: {
      "/api/*": (req) => api.fetch(req),
      "/": indexHtml.default,
      "/*": indexHtml.default,
    },
  });
}

async function startProd(api: ReturnType<typeof createApp>, port: number, hostname: string) {
  // Static-string dynamic imports so `bun build --compile` inlines dist/ui/* into
  // the binary. Outside the compiled binary, these resolve from disk and require
  // `bun run scripts/build-ui.ts` to have been run first.
  const [{ default: indexHtmlPath }, { default: indexJsPath }, { default: indexCssPath }] = await Promise.all([
    import("../../../dist/ui/index.html" as string, { with: { type: "file" } }),
    import("../../../dist/ui/index.js" as string, { with: { type: "file" } }),
    import("../../../dist/ui/index.css" as string, { with: { type: "file" } }),
  ]);

  return Bun.serve({
    port,
    hostname,
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/")) return api.fetch(req);
      if (url.pathname === "/index.js") {
        return new Response(Bun.file(indexJsPath), {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
      if (url.pathname === "/index.css") {
        return new Response(Bun.file(indexCssPath), {
          headers: {
            "Content-Type": "text/css; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
      return new Response(Bun.file(indexHtmlPath), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });
}

export async function startServer(options: ServerOptions = {}) {
  const port = options.port ?? 8080;
  const host = options.host ?? "0.0.0.0";

  getDb(options.dbPath);

  const api = createApp();

  let server: ReturnType<typeof Bun.serve>;
  let mode: "dev" | "prod" = options.dev ? "dev" : "prod";

  if (options.dev) {
    server = await startDev(api, port, host);
  } else {
    try {
      server = await startProd(api, port, host);
    } catch (err) {
      // Source-run without `bun run scripts/build-ui.ts` — fall back to dev bundle.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[zond ui] dist/ui/ assets missing (${msg}); falling back to dev bundle`);
      server = await startDev(api, port, host);
      mode = "dev";
    }
  }

  const { getRuntimeInfo } = await import("../../cli/runtime.ts");
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  const tag = mode === "dev" ? " [dev]" : "";
  console.log(`zond server (${getRuntimeInfo()}) running at http://${displayHost}:${server.port}${tag}`);

  return server;
}

if (import.meta.main) {
  await startServer({
    dev: true,
    port: Number(process.env.ZOND_UI_PORT ?? 6421),
    host: process.env.ZOND_UI_HOST ?? "localhost",
  });
}

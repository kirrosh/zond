import { Hono } from "hono";
import { resolve } from "node:path";
import { getDb } from "../../db/schema.ts";
import {
  countRuns,
  countSessions,
  getCollectionById,
  getLatestRunForSuite,
  getResultById,
  getResultsByRunId,
  getRunById,
  listRuns,
  listRunsBySession,
  listSessions,
} from "../../db/queries.ts";
import { renderCaseStudy } from "../../core/exporter/case-study/index.ts";
import { resolveAdHocRequest, sendAdHocRequest } from "../../core/runner/send-request.ts";
import { readOpenApiSpec } from "../../core/generator/openapi-reader.ts";
import { VERSION } from "../../cli/version.ts";
import { parseDirectorySafe } from "../../core/parser/yaml-parser.ts";
import { findWorkspaceRoot } from "../../core/workspace/root.ts";

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

  app.get("/api/sessions", (c) => {
    const limitRaw = Number(c.req.query("limit") ?? DEFAULT_LIMIT);
    const offsetRaw = Number(c.req.query("offset") ?? 0);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), MAX_LIMIT) : DEFAULT_LIMIT;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
    try {
      const sessions = listSessions(limit, offset);
      const total = countSessions();
      return c.json({ sessions, total, limit, offset });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.get("/api/sessions/:id/runs", (c) => {
    const sessionId = c.req.param("id");
    if (!sessionId) return c.json({ error: "missing session id" }, 400);
    try {
      const runs = listRunsBySession(sessionId);
      return c.json({ session_id: sessionId, runs });
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

  app.get("/api/suites", async (c) => {
    const overridePath = c.req.query("path");
    const root = overridePath ? resolve(overridePath) : findWorkspaceRoot().root;
    try {
      const { suites, errors } = await parseDirectorySafe(root);
      const items = suites.map((suite) => {
        const file = suite.filePath ?? null;
        const last = file ? getLatestRunForSuite(file) : null;
        return {
          name: suite.name,
          description: suite.description ?? null,
          file,
          source: suite.source ?? null,
          tests: suite.tests.map((t) => ({
            name: t.name,
            method: t.method,
            path: t.path,
            source: t.source ?? null,
          })),
          step_count: suite.tests.length,
          tags: suite.tags ?? [],
          last_run: last,
        };
      });
      return c.json({ root, suites: items, errors });
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

  app.post("/api/replay", async (c) => {
    let payload: {
      method?: string;
      url?: string;
      headers?: Record<string, string>;
      body?: string;
      resultId?: number;
      envName?: string;
      timeout?: number;
      dryRun?: boolean;
    };
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    if (!payload.method || typeof payload.method !== "string") {
      return c.json({ error: "method required" }, 400);
    }
    if (!payload.url || typeof payload.url !== "string") {
      return c.json({ error: "url required" }, 400);
    }

    let extraVars: Record<string, unknown> | undefined;
    let collectionName: string | undefined;
    let envName = payload.envName;
    if (typeof payload.resultId === "number" && Number.isFinite(payload.resultId)) {
      const result = getResultById(payload.resultId);
      if (result) {
        if (result.captures && Object.keys(result.captures).length > 0) {
          extraVars = result.captures;
        }
        const run = getRunById(result.run_id);
        if (run?.collection_id != null) {
          const col = getCollectionById(run.collection_id);
          if (col) collectionName = col.name;
        }
        if (!envName && run?.environment) envName = run.environment;
      }
    }

    const opts = {
      method: payload.method.toUpperCase(),
      url: payload.url,
      headers: payload.headers,
      body: payload.body,
      timeout: payload.timeout,
      envName,
      collectionName,
      extraVars,
    };

    try {
      if (payload.dryRun) {
        const resolved = await resolveAdHocRequest(opts);
        return c.json({ resolved });
      }
      const resolved = await resolveAdHocRequest(opts);
      const response = await sendAdHocRequest(opts);
      return c.json({ resolved, response });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 200);
    }
  });

  app.get("/api/results/:id/case-study.md", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) {
      return c.json({ error: "invalid result id" }, 400);
    }
    try {
      const result = getResultById(id);
      if (!result) return c.json({ error: "result not found" }, 404);
      const run = getRunById(result.run_id);
      if (!run) return c.json({ error: "run not found" }, 404);

      let specTitle: string | null = null;
      let specVersion: string | null = null;
      if (run.collection_id != null) {
        const col = getCollectionById(run.collection_id);
        if (col?.openapi_spec) {
          try {
            const doc = await readOpenApiSpec(col.openapi_spec);
            specTitle = doc.info?.title ?? null;
            specVersion = doc.info?.version ?? null;
          } catch {
            // Best-effort — leave TODO placeholders in the draft.
          }
        }
      }

      const md = renderCaseStudy({
        result,
        run,
        specTitle,
        specVersion,
        zondVersion: VERSION,
      });
      return new Response(md, {
        status: 200,
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
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

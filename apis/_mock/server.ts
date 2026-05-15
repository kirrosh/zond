/**
 * ARV-193 — mock-API testbed for regression-validating m-20 stateful
 * probes. Bun.serve() implementation, no external deps.
 *
 * Each declared bug below maps 1:1 to one probe. When the upstream
 * probe behaviour changes (severity rebalance, new anti-FP guard,
 * different evidence shape) this file plus
 * tests/regression/mock-testbed.test.ts is the regression-floor that
 * tells us whether the probe still detects its target class.
 *
 * Bugs:
 *   • B1 cross_call_references — POST /widgets echoes `color` in the
 *     201 body but the in-memory store strips it, so GET /widgets/{id}
 *     returns the row without `color`. The probe surfaces it as
 *     `state_not_persisted` (high signal).
 *   • B2 pagination_invariants — list returns items in a fixed order;
 *     the cursor handler is off-by-one and includes `starting_after`'s
 *     own row at the head of page B (duplicate item across pages).
 *   • B3 idempotency_replay — POST /widgets ignores the
 *     Idempotency-Key header and always allocates a new id, so two
 *     replays produce different ids (`duplicate_resource`).
 *   • B4 lifecycle_transitions — POST /widgets/{id}/publish accepts
 *     the call (200) but never advances `status`; GET still shows
 *     `draft` even though yaml advertises `published` as the action's
 *     expected state (`wrong_expected_state`).
 *
 * Usage:
 *   bun apis/_mock/server.ts                # starts on $PORT or 7717
 *   bun apis/_mock/server.ts --port 0       # ephemeral port (tests)
 */

interface Widget {
  id: string;
  name: string;
  color?: string; // intentionally optional — see B1
  status: "draft" | "published" | "archived";
}

export interface MockServer {
  port: number;
  baseUrl: string;
  stop: () => Promise<void>;
}

/** Spin up a fresh testbed instance. Each call resets state, seeds
 *  enough widgets for the pagination probe to walk two pages, and
 *  returns the bound port + a stop() that drains in-flight requests. */
export function startMockServer(opts: { port?: number } = {}): MockServer {
  const store = new Map<string, Widget>();
  let nextId = 0;
  const allocId = (): string => `wgt_${++nextId}`;

  // Seed: pagination needs at least limit+1 items so page B is non-empty
  // and the off-by-one duplication is observable.
  for (let i = 0; i < 5; i++) {
    const id = allocId();
    store.set(id, { id, name: `seed-${i}`, color: "red", status: "draft" });
  }

  function widgetForRead(w: Widget): Omit<Widget, "color"> {
    // B1: read-shape strips `color`. POST echo keeps it.
    const { color: _color, ...rest } = w;
    void _color;
    return rest;
  }

  function listWidgets(limit: number, startingAfter: string | null): { data: Widget[]; has_more: boolean } {
    const all = [...store.values()];
    let startIdx = 0;
    if (startingAfter != null) {
      const idx = all.findIndex((w) => w.id === startingAfter);
      // B2: off-by-one. Spec/contract says "items strictly after the
      // cursor", so startIdx should be idx+1. The bug uses idx, which
      // re-emits the cursor row at the head of page B.
      startIdx = idx >= 0 ? idx : 0;
    }
    const slice = all.slice(startIdx, startIdx + limit).map(widgetForRead) as Widget[];
    const has_more = startIdx + limit < all.length;
    return { data: slice, has_more };
  }

  async function readBody(req: Request): Promise<Record<string, unknown>> {
    if (req.method === "GET" || req.method === "DELETE" || req.method === "HEAD") return {};
    const txt = await req.text();
    if (!txt) return {};
    try { return JSON.parse(txt) as Record<string, unknown>; } catch { return {}; }
  }

  function json(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  }

  const server = Bun.serve({
    port: opts.port ?? Number(Bun.env.PORT ?? 7717),
    hostname: "127.0.0.1",
    development: false,
    async fetch(req) {
      const url = new URL(req.url);
      const m = req.method.toUpperCase();
      const p = url.pathname;

      // POST /widgets — create. B3 ignores Idempotency-Key.
      if (p === "/widgets" && m === "POST") {
        const body = await readBody(req);
        const id = allocId();
        const widget: Widget = {
          id,
          name: typeof body.name === "string" ? body.name : "unnamed",
          color: typeof body.color === "string" ? body.color : undefined,
          status: "draft",
        };
        // Persist WITHOUT color → B1.
        store.set(id, { id, name: widget.name, status: "draft" });
        // Echo WITH color → B1 contract: POST echoed, GET dropped.
        return json(widget, { status: 201 });
      }

      // GET /widgets — list with cursor. B2 off-by-one.
      if (p === "/widgets" && m === "GET") {
        const limit = Number(url.searchParams.get("limit") ?? "2");
        const startingAfter = url.searchParams.get("starting_after");
        return json(listWidgets(limit, startingAfter));
      }

      // GET/DELETE /widgets/{id}/...
      const itemMatch = p.match(/^\/widgets\/([^/]+)(?:\/(publish))?$/);
      if (itemMatch) {
        const id = itemMatch[1]!;
        const action = itemMatch[2];
        const w = store.get(id);

        if (action === "publish" && m === "POST") {
          if (!w) return json({ error: "not_found" }, { status: 404 });
          // B4: pretend to publish but never advance status.
          return json(widgetForRead(w));
        }
        if (m === "GET") {
          if (!w) return json({ error: "not_found" }, { status: 404 });
          return json(widgetForRead(w));
        }
        if (m === "DELETE") {
          store.delete(id);
          return new Response(null, { status: 204 });
        }
      }

      return json({ error: "not_found", path: p, method: m }, { status: 404 });
    },
  });

  return {
    port: server.port ?? 0,
    baseUrl: `http://127.0.0.1:${server.port ?? 0}`,
    stop: async () => { await server.stop(true); },
  };
}

// CLI entry — `bun apis/_mock/server.ts`.
if (import.meta.main) {
  const portArgIdx = process.argv.indexOf("--port");
  const port = portArgIdx >= 0 ? Number(process.argv[portArgIdx + 1] ?? "0") : undefined;
  const srv = startMockServer({ port });
  console.log(`mock testbed listening on ${srv.baseUrl}`);
  const stop = async (): Promise<void> => { await srv.stop(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

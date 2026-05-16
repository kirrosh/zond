/**
 * ARV-8 stability tests:
 *
 *   AC #3 — `--workers 16` on a multi-resource petstore-style mock —
 *           every CRUD-chain still completes; siblings parallelize, but
 *           parents-before-children stays intact (the *check* owns chain
 *           ordering, the pool only runs independent groups in parallel).
 *
 *   AC #4 — same set with default workers (=1) produces an identical
 *           findings array — proves the pool didn't change semantics.
 *
 * The mock implements three CRUD groups (widgets, gadgets, sprockets)
 * with strict per-id state — a botched parallelization would produce
 * 404 / use_after_free false-positives because parents weren't created
 * before children.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks } from "../../../src/core/checks/index.ts";

interface Store {
  next: number;
  alive: Set<number>;
}

function crudPaths(name: string) {
  return {
    [`/${name}`]: {
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object", properties: { name: { type: "string" } } },
            },
          },
        },
        responses: { "201": { description: "created" } },
      },
      get: { responses: { "200": { description: "ok" } } },
    },
    [`/${name}/{id}`]: {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
      get: {
        responses: { "200": { description: "ok" }, "404": { description: "gone" } },
      },
      delete: { responses: { "204": { description: "deleted" }, "404": { description: "gone" } } },
    },
  } as Record<string, unknown>;
}

describe("ARV-8: --workers stability on parallel CRUD chains", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;

  beforeAll(async () => {
    const stores = new Map<string, Store>([
      ["widgets", { next: 1, alive: new Set() }],
      ["gadgets", { next: 1, alive: new Set() }],
      ["sprockets", { next: 1, alive: new Set() }],
    ]);
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        const parts = u.pathname.split("/").filter(Boolean);
        const resource = parts[0]!;
        const store = stores.get(resource);
        if (!store) return new Response("not found", { status: 404 });
        if (parts.length === 1) {
          if (req.method === "POST") {
            const id = store.next++;
            store.alive.add(id);
            return Response.json({ id }, { status: 201 });
          }
          if (req.method === "GET") {
            return Response.json([...store.alive].map((id) => ({ id })));
          }
        }
        if (parts.length === 2) {
          const id = Number.parseInt(parts[1]!, 10);
          if (req.method === "GET") {
            return store.alive.has(id)
              ? Response.json({ id, name: `${resource}-${id}` })
              : new Response("gone", { status: 404 });
          }
          if (req.method === "DELETE") {
            const ok = store.alive.delete(id);
            return new Response(null, { status: ok ? 204 : 404 });
          }
        }
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
    tmpDir = join(tmpdir(), `zond-arv8-stab-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "shop", version: "1" },
        paths: { ...crudPaths("widgets"), ...crudPaths("gadgets"), ...crudPaths("sprockets") },
      }),
      "utf-8",
    );
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("AC #3 — workers=16 keeps every CRUD chain intact (no false positives)", async () => {
    const result = await runChecks({
      specPath,
      baseUrl,
      include: ["ensure_resource_availability", "use_after_free"],
      workers: 16,
    });
    // The mock is well-behaved (delete sticks; reads of live resources
    // succeed). Both chain checks should produce zero findings — a
    // botched parallelization would surface as a `404 after create` on
    // ensure_resource_availability or a stale-id `200 after delete`.
    const chainFindings = result.data.findings.filter(
      (f) => f.check === "ensure_resource_availability" || f.check === "use_after_free",
    );
    expect(chainFindings).toEqual([]);
  });

  test("AC #4 — workers=1 (default) and workers=8 produce the same findings", async () => {
    const sequential = await runChecks({
      specPath,
      baseUrl,
      include: ["ensure_resource_availability", "use_after_free"],
    });
    const parallel = await runChecks({
      specPath,
      baseUrl,
      include: ["ensure_resource_availability", "use_after_free"],
      workers: 8,
    });
    // Same shape, same checks — the only thing that should differ is
    // wall-clock time.
    expect(parallel.data.findings.length).toBe(sequential.data.findings.length);
    expect(parallel.data.summary.findings).toBe(sequential.data.summary.findings);
    expect(parallel.high_or_critical).toBe(sequential.high_or_critical);
  });

  test("AC #4 — non-stateful checks: workers=4 vs default produce identical finding shapes", async () => {
    const seq = await runChecks({
      specPath,
      baseUrl,
      include: ["not_a_server_error", "status_code_conformance"],
    });
    const par = await runChecks({
      specPath,
      baseUrl,
      include: ["not_a_server_error", "status_code_conformance"],
      workers: 4,
    });
    expect(par.data.summary.cases).toBe(seq.data.summary.cases);
    expect(par.data.summary.operations).toBe(seq.data.summary.operations);
    expect(par.data.findings.length).toBe(seq.data.findings.length);
    // Findings come back in input-order for the op array — identical
    // sort key sequences across workers.
    const seqKeys = seq.data.findings.map((f) => `${f.check}|${f.operation.method}|${f.operation.path}`);
    const parKeys = par.data.findings.map((f) => `${f.check}|${f.operation.method}|${f.operation.path}`);
    expect(parKeys).toEqual(seqKeys);
  });
});

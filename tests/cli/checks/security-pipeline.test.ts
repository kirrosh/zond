/**
 * Integration tests for the ARV-3 stateful security checks against
 * Bun.serve mock servers. Covers AC #4 (broken-auth → ignored_auth)
 * and AC #5 (leak after delete → use_after_free).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks } from "../../../src/core/checks/index.ts";

describe("ARV-3 AC #4 — ignored_auth on a broken-auth server", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        // Always 200 — the server "ignores" the Authorization header.
        if (req.method === "GET" && new URL(req.url).pathname === "/secure") {
          return Response.json({ ok: true });
        }
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
    tmpDir = join(tmpdir(), `zond-arv3-auth-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      components: {
        securitySchemes: {
          bearer: { type: "http", scheme: "bearer" },
        },
      },
      paths: {
        "/secure": {
          get: {
            security: [{ bearer: [] }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    }), "utf-8");
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("ignored_auth fires when server accepts no-auth and bogus", async () => {
    const result = await runChecks({
      specPath,
      baseUrl,
      include: ["ignored_auth"],
      authHeaders: { Authorization: "Bearer real" },
    });
    const finding = result.data.findings.find((f) => f.check === "ignored_auth");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(result.high_or_critical).toBeGreaterThanOrEqual(1);
  });

  test("ignored_auth skipped when bootstrap-cleanup-failed flag set", async () => {
    const result = await runChecks({
      specPath,
      baseUrl,
      include: ["ignored_auth"],
      authHeaders: { Authorization: "Bearer real" },
      bootstrapCleanupFailed: true,
    });
    expect(result.data.findings.find((f) => f.check === "ignored_auth")).toBeUndefined();
  });
});

describe("ARV-3 AC #5 — use_after_free on a leak-after-delete server", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;

  beforeAll(async () => {
    let nextId = 100;
    // Buggy backend: DELETE returns 204 but the GET keeps returning 200.
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        if (req.method === "POST" && u.pathname === "/widgets") {
          return Response.json({ id: nextId++ }, { status: 201 });
        }
        if (req.method === "DELETE" && /^\/widgets\/\d+$/.test(u.pathname)) {
          return new Response(null, { status: 204 });
        }
        if (req.method === "GET" && /^\/widgets\/\d+$/.test(u.pathname)) {
          // BUG — resource still readable after delete.
          const id = u.pathname.split("/").pop()!;
          return Response.json({ id: Number(id), name: "ghost" });
        }
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
    tmpDir = join(tmpdir(), `zond-arv3-uaf-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/widgets": {
          post: {
            requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } } },
            responses: { "201": { description: "created" } },
          },
        },
        "/widgets/{id}": {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          get: { responses: { "200": { description: "ok" }, "404": { description: "gone" } } },
          delete: { responses: { "204": { description: "deleted" } } },
        },
      },
    }), "utf-8");
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("use_after_free fires when GET succeeds after DELETE", async () => {
    const result = await runChecks({
      specPath,
      baseUrl,
      include: ["use_after_free"],
    });
    const finding = result.data.findings.find((f) => f.check === "use_after_free");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.evidence?.get_status_after_delete).toBe(200);
  });

  test("ensure_resource_availability passes on this same chain (read works)", async () => {
    const result = await runChecks({
      specPath,
      baseUrl,
      include: ["ensure_resource_availability"],
    });
    expect(result.data.findings.find((f) => f.check === "ensure_resource_availability")).toBeUndefined();
  });
});

/**
 * Integration tests for `x-zond-*` extensions wired through runChecks
 * (ARV-189, m-21).
 *
 * Two scenarios pinned end-to-end:
 *   - `x-zond-skip: [id]` on an operation suppresses the named check
 *     and surfaces the spec-level skip reason in skipped_outcomes.
 *   - `x-zond-public: true` short-circuits auth-class checks for that
 *     operation.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks } from "../../../src/core/checks/index.ts";

describe("ARV-189: x-zond-* extensions via runChecks", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        // Public/health endpoints: 200 no body; private endpoints: 401
        // when no auth header so ignored_auth WOULD fire if not skipped.
        if (url.pathname === "/health") {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(null, { status: 401 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    tmpDir = join(tmpdir(), `zond-arv189-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("x-zond-skip suppresses the listed check id; skipped_outcomes records the reason", async () => {
    const specPath = join(tmpDir, "skip-spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      paths: {
        "/health": {
          get: {
            "x-zond-skip": ["status_code_conformance"],
            responses: {
              // Spec says 201 but server returns 200 → status_code_conformance
              // would normally fire. The x-zond-skip should suppress it.
              "201": { description: "created" },
            },
          },
        },
      },
    }), "utf-8");

    const result = await runChecks({
      specPath,
      baseUrl,
      include: ["status_code_conformance"],
    });
    const summary = result.data.summary;
    expect(summary.findings).toBe(0);
    const skipKeys = Object.keys(summary.skipped_outcomes);
    const matching = skipKeys.filter(k => k.startsWith("status_code_conformance:") && k.includes("x-zond-skip"));
    expect(matching.length).toBeGreaterThan(0);
  });

  test("x-zond-public: true suppresses ignored_auth on that operation", async () => {
    // Endpoint A: x-zond-public → ignored_auth should be SKIPPED.
    // Endpoint B: no extensions → ignored_auth should run normally.
    const specPath = join(tmpDir, "public-spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      components: {
        securitySchemes: {
          bearer: { type: "http", scheme: "bearer" },
        },
      },
      security: [{ bearer: [] }],
      paths: {
        "/health": {
          get: {
            "x-zond-public": true,
            responses: { "200": { description: "ok" } },
          },
        },
        "/private": {
          get: {
            responses: { "200": { description: "ok" } },
          },
        },
      },
    }), "utf-8");

    const result = await runChecks({
      specPath,
      baseUrl,
      include: ["ignored_auth"],
    });
    const summary = result.data.summary;
    const skipKeys = Object.keys(summary.skipped_outcomes);
    const publicSkips = skipKeys.filter(k => k.startsWith("ignored_auth:") && k.includes("x-zond-public"));
    // x-zond-public must have caused at least one skip on /health.
    expect(publicSkips.length).toBeGreaterThan(0);
  });
});

/**
 * Integration test for the ARV-1 pipeline:
 *   - mock OpenAPI spec with 3 operations,
 *   - Bun.serve mock server with one endpoint that 5xx's,
 *   - runChecks() should call the seed `not_a_server_error` check on
 *     each operation and produce exactly one finding.
 *
 * Also asserts the JSON envelope shape stays stable (snapshot of fields).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks, listChecks } from "../../../src/core/checks/index.ts";
import { ChecksRunDataSchema } from "../../../src/cli/json-schemas.ts";

describe("zond checks pipeline (ARV-1)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/healthz" && req.method === "GET") {
          return Response.json({ ok: true });
        }
        if (url.pathname.startsWith("/widgets/") && req.method === "GET") {
          return Response.json({ id: 1, name: "widget" });
        }
        if (url.pathname === "/explode" && req.method === "GET") {
          // Trigger not_a_server_error.
          return new Response("boom", { status: 503 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    tmpDir = join(tmpdir(), `zond-checks-arv1-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      paths: {
        "/healthz": { get: { responses: { "200": { description: "ok" } } } },
        "/widgets/{id}": {
          get: {
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
            responses: { "200": { description: "ok" } },
          },
        },
        "/explode": { get: { responses: { "200": { description: "ok" } } } },
      },
    }), "utf-8");
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("registry has the seed check registered after import", () => {
    const ids = listChecks().map((c) => c.id);
    expect(ids).toContain("not_a_server_error");
  });

  test("runChecks runs against all 3 operations and finds the 5xx", async () => {
    const result = await runChecks({ specPath, baseUrl });
    expect(result.data.summary.operations).toBe(3);
    expect(result.data.summary.cases).toBe(3);
    expect(result.data.summary.checks_run).toBeGreaterThanOrEqual(1);
    expect(result.data.findings.length).toBe(1);
    const f = result.data.findings[0]!;
    expect(f.check).toBe("not_a_server_error");
    expect(f.severity).toBe("high");
    expect(f.operation.path).toBe("/explode");
    expect(f.response_summary.status).toBe(503);
    expect(result.high_or_critical).toBe(1);
  });

  test("--exclude-check skips the seed check", async () => {
    const result = await runChecks({
      specPath,
      baseUrl,
      exclude: ["not_a_server_error"],
    });
    expect(result.data.findings.length).toBe(0);
    expect(result.high_or_critical).toBe(0);
  });

  test("unknown --check id is reported in selection.unknown", async () => {
    const result = await runChecks({ specPath, baseUrl, include: ["ghost_check"] });
    expect(result.selection.unknown).toContain("ghost_check");
    expect(result.data.findings.length).toBe(0);
  });

  test("CheckRunData payload validates against the published JSON Schema", async () => {
    const result = await runChecks({ specPath, baseUrl });
    const parsed = ChecksRunDataSchema.safeParse(result.data);
    expect(parsed.success).toBe(true);
  });

  test("finding shape is stable (snapshot of envelope keys)", async () => {
    const result = await runChecks({ specPath, baseUrl });
    const f = result.data.findings[0]!;
    expect(Object.keys(f).sort()).toEqual([
      "check",
      "evidence",
      "message",
      "operation",
      "request_signature",
      "response_summary",
      "severity",
    ].sort().filter((k) => k in f));
    // Required fields are always present.
    for (const k of [
      "check", "severity", "operation", "request_signature", "response_summary", "message",
    ]) {
      expect(f).toHaveProperty(k);
    }
  });
});

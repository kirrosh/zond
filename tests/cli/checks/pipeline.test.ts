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

  test("registry has the seed check + ARV-2 checks registered after import", () => {
    const ids = listChecks().map((c) => c.id);
    for (const id of [
      "not_a_server_error",
      "status_code_conformance",
      "content_type_conformance",
      "response_headers_conformance",
      "response_schema_conformance",
      "missing_required_header",
      "unsupported_method",
    ]) expect(ids).toContain(id);
  });

  test("runChecks --check not_a_server_error finds the 5xx (ARV-2 AC #5)", async () => {
    const result = await runChecks({
      specPath,
      baseUrl,
      include: ["not_a_server_error"],
    });
    expect(result.data.summary.operations).toBe(3);
    // Only positive cases — exactly one per op.
    expect(result.data.summary.cases).toBe(3);
    expect(result.data.findings.length).toBe(1);
    const f = result.data.findings[0]!;
    expect(f.check).toBe("not_a_server_error");
    expect(f.severity).toBe("high");
    expect(f.operation.path).toBe("/explode");
    expect(f.response_summary.status).toBe(503);
    expect(result.high_or_critical).toBe(1);
  });

  test("--exclude-check on every check produces no findings", async () => {
    const allIds = listChecks().map((c) => c.id);
    const result = await runChecks({
      specPath,
      baseUrl,
      exclude: allIds,
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
    const result = await runChecks({ specPath, baseUrl, include: ["not_a_server_error"] });
    const parsed = ChecksRunDataSchema.safeParse(result.data);
    expect(parsed.success).toBe(true);
  });

  test("ARV-11 AC #2 — recommended_action is populated on every finding", async () => {
    const result = await runChecks({ specPath, baseUrl });
    expect(result.data.findings.length).toBeGreaterThan(0);
    for (const f of result.data.findings) {
      expect(f.recommended_action).toBeDefined();
      // Must be a value the published enum knows about — guards against
      // a string slipping past the type when someone edits in raw text.
      expect([
        "report_backend_bug", "fix_auth_config", "fix_test_logic",
        "fix_network_config", "fix_env", "fix_spec", "fix_fixture",
        "tighten_validation", "add_required_header", "wontfix_known_limitation",
      ]).toContain(f.recommended_action as string);
    }
  });

  test("finding shape is stable (snapshot of envelope keys)", async () => {
    const result = await runChecks({ specPath, baseUrl, include: ["not_a_server_error"] });
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

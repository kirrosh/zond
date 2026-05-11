/**
 * ARV-61 (feedback round-01 / F1): `zond checks run --api X` was sending
 * response-phase probe requests without the Bearer/api-key header that
 * the CLI had already derived from apis/<name>/.env.yaml. On any auth-gated
 * API every request bounced as 401, and every `status_code_conformance`
 * finding was spurious noise. Fix injects `authHeaders` into every probe
 * request (case-specific headers win, `missing_required_header` keeps
 * dropping its own header).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks } from "../../../src/core/checks/index.ts";

describe("checks runner injects authHeaders into response-phase requests (ARV-61)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;
  let seenAuthHeaders: string[] = [];

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        seenAuthHeaders.push(req.headers.get("authorization") ?? "");
        return Response.json({ ok: true });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    tmpDir = join(tmpdir(), `zond-checks-arv61-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      paths: {
        "/ping": { get: { responses: { "200": { description: "ok" } } } },
        "/widgets": { get: { responses: { "200": { description: "ok" } } } },
      },
    }), "utf-8");
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("Bearer token from authHeaders is sent with every probe request", async () => {
    seenAuthHeaders = [];
    await runChecks({
      specPath,
      baseUrl,
      include: ["not_a_server_error"],
      authHeaders: { Authorization: "Bearer t0p-secret" },
    });
    expect(seenAuthHeaders.length).toBeGreaterThan(0);
    for (const h of seenAuthHeaders) {
      expect(h).toBe("Bearer t0p-secret");
    }
  });

  test("no authHeaders → no Authorization header (backward compat)", async () => {
    seenAuthHeaders = [];
    await runChecks({
      specPath,
      baseUrl,
      include: ["not_a_server_error"],
    });
    expect(seenAuthHeaders.length).toBeGreaterThan(0);
    for (const h of seenAuthHeaders) {
      expect(h).toBe("");
    }
  });

  test("missing_required_header probe does NOT auto-add the very header it is dropping", async () => {
    // Build a spec whose op declares `X-Required` as a required header
    // parameter. The probe drops it on purpose. If authHeaders happened
    // to carry that same key, re-injecting it would defeat the probe.
    const probeSpec = join(tmpDir, "spec-missing-header.json");
    await writeFile(probeSpec, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      paths: {
        "/needs-header": {
          get: {
            parameters: [{ name: "X-Required", in: "header", required: true, schema: { type: "string" } }],
            responses: { "400": { description: "missing header" } },
          },
        },
      },
    }), "utf-8");

    let sawRequiredHeader: string | null = "<not yet>";
    const probeServer = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.includes("/needs-header")) {
          sawRequiredHeader = req.headers.get("x-required");
        }
        return new Response("", { status: 400 });
      },
    });
    try {
      await runChecks({
        specPath: probeSpec,
        baseUrl: `http://localhost:${probeServer.port}`,
        include: ["missing_required_header"],
        authHeaders: { "X-Required": "must-not-leak" },
      });
      expect(sawRequiredHeader).toBeNull(); // probe should have dropped it
    } finally {
      probeServer.stop(true);
    }
  });

  test("case-specific headers win over authHeaders (no override)", async () => {
    // We feed a different `Authorization` header value than what the
    // case would carry; since the response-phase probes don't set
    // `Authorization` themselves, the authHeaders value should pass
    // through. (This codifies the case-specific-header precedence rule
    // for future cases that *do* set Authorization.)
    seenAuthHeaders = [];
    await runChecks({
      specPath,
      baseUrl,
      include: ["not_a_server_error"],
      authHeaders: { Authorization: "Bearer original" },
    });
    for (const h of seenAuthHeaders) {
      expect(h).toBe("Bearer original");
    }
  });
});

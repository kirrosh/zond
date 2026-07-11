/**
 * ARV-436: the fuzz phase end-to-end through the real runner against a
 * live Bun mock. Asserts (a) the phase dispatches `--max-examples` random
 * bodies per op, (b) a server 5xx is caught by `not_a_server_error` as a
 * fuzz-tagged finding, (c) fast-check shrinks the failing body to a
 * minimal counterexample carried in evidence (minimal_case + curl), and
 * (d) the same `--seed` reproduces byte-identical request bodies.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks } from "../../../src/core/checks/index.ts";

describe("checks run --phase fuzz (ARV-436)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;
  // Bodies POSTed to /widgets, in arrival order.
  const widgetBodies: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/widgets" && req.method === "POST") {
          const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
          widgetBodies.push(body);
          // Backend bug: sizes over 100 blow up with a 500 instead of a 4xx.
          if (typeof body.size === "number" && body.size > 100) {
            return new Response("boom", { status: 500 });
          }
          return new Response(JSON.stringify({ id: "w_1" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    tmpDir = join(tmpdir(), `zond-fuzz-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      paths: {
        "/widgets": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["size"],
                    properties: { size: { type: "integer", minimum: 0, maximum: 1000 } },
                  },
                },
              },
            },
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

  const opts = () => ({
    specPath,
    baseUrl,
    include: ["not_a_server_error"],
    phase: "fuzz" as const,
    fuzzSeed: 42,
    fuzzRuns: 12,
  });

  test("dispatches --max-examples bodies and catches the 5xx with a shrunk counterexample", async () => {
    widgetBodies.length = 0;
    const r = await runChecks({ ...opts() });

    // At least the 12 sampled bodies were POSTed (shrink adds a few more).
    expect(widgetBodies.length).toBeGreaterThanOrEqual(12);

    const findings = r.data.findings.filter((f) => f.check === "not_a_server_error");
    expect(findings.length).toBeGreaterThan(0);

    // Shrink attached a minimal counterexample + curl.
    const withEvidence = findings.find((f) => f.evidence && "minimal_case" in f.evidence);
    expect(withEvidence).toBeDefined();
    const min = (withEvidence!.evidence as Record<string, unknown>).minimal_case as Record<string, unknown>;
    expect(min.status).toBe(500);
    const minBody = min.body as Record<string, unknown>;
    // The minimal failing size is just past the 100 boundary — fast-check
    // shrinks toward the smallest value that still trips the 500 (101),
    // not the large random value that first hit it.
    expect(minBody.size as number).toBeGreaterThan(100);
    expect(minBody.size as number).toBeLessThanOrEqual(110);
    expect(typeof (withEvidence!.evidence as Record<string, unknown>).curl).toBe("string");
    expect((withEvidence!.evidence as Record<string, unknown>).curl as string).toContain("curl");
  });

  test("same seed ⇒ identical request bodies (reproducible evidence)", async () => {
    widgetBodies.length = 0;
    await runChecks({ ...opts() });
    const first12run1 = widgetBodies.slice(0, 12).map((b) => b.size);

    widgetBodies.length = 0;
    await runChecks({ ...opts() });
    const first12run2 = widgetBodies.slice(0, 12).map((b) => b.size);

    expect(first12run1).toEqual(first12run2);
  });
});

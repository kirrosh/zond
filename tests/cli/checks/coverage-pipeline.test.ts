/**
 * Integration test for the ARV-6 coverage phase (AC #3).
 *
 * Mocks a server that 200's *only* on the `name=maxLength+1` body —
 * i.e. accepts a 9-char name where the schema says 8 is the max — and
 * 400's everything else. The runner with `--phase coverage` should
 * surface exactly one `negative_data_rejection` finding whose evidence
 * carries `meta.boundary === 'maxLength+1'`.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks } from "../../../src/core/checks/index.ts";

describe("ARV-6 coverage-phase pipeline", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method !== "POST") return new Response(null, { status: 405 });
        const url = new URL(req.url);
        if (url.pathname !== "/widgets") return new Response(null, { status: 404 });
        let body: { name?: unknown; qty?: unknown } | null = null;
        try { body = (await req.json()) as { name?: unknown; qty?: unknown }; }
        catch { return new Response(null, { status: 400 }); }
        // ONLY accept (HTTP 200) when name length === 9 (i.e. maxLength+1).
        // Every other case — including the valid name length 8 — gets 400.
        // Combined with the runner only emitting negative cases here, we
        // expect exactly one finding tagged with the maxLength+1 boundary.
        const name = body?.name;
        if (typeof name === "string" && name.length === 9) {
          return Response.json({ id: 1 }, { status: 200 });
        }
        return new Response(null, { status: 400 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
    tmpDir = join(tmpdir(), `zond-arv6-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/widgets": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["name", "qty"],
                    properties: {
                      name: { type: "string", minLength: 3, maxLength: 8 },
                      qty: { type: "integer", minimum: 1, maximum: 100 },
                    },
                  },
                },
              },
            },
            responses: { "200": { description: "ok" }, "400": { description: "bad" } },
          },
        },
      },
    }), "utf-8");
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("AC#3 — coverage phase fires exactly one finding with meta.boundary='maxLength+1'", async () => {
    const result = await runChecks({
      specPath,
      baseUrl,
      include: ["negative_data_rejection"],
      phase: "coverage",
    });
    const findings = result.data.findings.filter((f) => f.check === "negative_data_rejection");
    expect(findings).toHaveLength(1);
    const ev = findings[0]!.evidence as { mutation?: { boundary?: string; field_path?: string } };
    expect(ev.mutation?.boundary).toBe("maxLength+1");
    expect(ev.mutation?.field_path).toBe("name");
  });
});

/**
 * ARV-26: regression — when a probe gets a response branch that has no
 * declared JSON Schema (e.g. probe runs without auth → 4xx → spec only
 * declares 200 schema), `response_schema_conformance` returns `kind: "skip"`.
 * The summary must surface that as `skipped_outcomes` so the CLI can print
 * "0 findings BUT N skipped" instead of leaving the user thinking everything
 * passed.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks } from "../../../src/core/checks/index.ts";

describe("ARV-26: skipped_outcomes summary", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(_req) {
        // Always reply 401 with no body — schema is only declared on 200,
        // so response_schema_conformance must SKIP, not pass.
        return new Response(null, { status: 401 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    tmpDir = join(tmpdir(), `zond-checks-arv26-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      paths: {
        "/widgets": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { type: "object", properties: { id: { type: "integer" } } },
                  },
                },
              },
              // 4XX intentionally not described — probe will hit 401 and skip.
            },
          },
        },
      },
    }), "utf-8");
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("response_schema_conformance skips on 401 with no schema branch — summary records the reason", async () => {
    const result = await runChecks({
      specPath,
      baseUrl,
      include: ["response_schema_conformance"],
    });
    const summary = result.data.summary;
    expect(summary.findings).toBe(0);
    const skipKeys = Object.keys(summary.skipped_outcomes);
    const matching = skipKeys.filter(k => k.startsWith("response_schema_conformance:"));
    expect(matching.length).toBeGreaterThan(0);
    const totalSkipped = matching.reduce((acc, k) => acc + (summary.skipped_outcomes[k] ?? 0), 0);
    expect(totalSkipped).toBeGreaterThan(0);
  });
});

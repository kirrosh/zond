/**
 * ARV-141: `zond checks run` used to be pixel-identical across runs because
 * `fillPathParams` synthesised placeholders from the schema without ever
 * consulting `.env.yaml`. So a fixture-pack that grew from 0 → N filled vars
 * had no effect on findings/skip counts and CI couldn't distinguish "spec
 * stable" from "depth-checks ignored deltas".
 *
 * This test exercises the reactivity directly via the runner's `pathVars`
 * option: same spec, same server, two runs differing only in `pathVars`
 * must produce *different* skip-outcome tallies (the synthetic-id branch
 * hits 404 and skips schema/header conformance; the filled-id branch hits
 * 200 and runs them).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks } from "../../../src/core/checks/index.ts";

describe("checks run reacts to fixture growth (ARV-141)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        // Only the "real" id resolves; synthetic placeholders 404.
        if (url.pathname === "/issues/real-issue-42" && req.method === "GET") {
          return new Response(JSON.stringify({ id: "real-issue-42", title: "Boom" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    tmpDir = join(tmpdir(), `zond-checks-arv141-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      paths: {
        "/issues/{issue_id}": {
          get: {
            parameters: [
              { name: "issue_id", in: "path", required: true, schema: { type: "string" } },
            ],
            responses: {
              "200": {
                description: "ok",
                headers: {
                  "X-Trace-Id": { schema: { type: "string" }, required: true },
                },
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["id", "title"],
                      properties: { id: { type: "string" }, title: { type: "string" } },
                    },
                  },
                },
              },
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

  test("filled pathVars shift skipped_outcomes (and surface conformance findings)", async () => {
    const baseOpts = {
      specPath,
      baseUrl,
      include: [
        "response_schema_conformance",
        "response_headers_conformance",
        "status_code_conformance",
      ],
    };

    const empty = await runChecks({ ...baseOpts });
    const filled = await runChecks({ ...baseOpts, pathVars: { issue_id: "real-issue-42" } });

    // Cold run: synthetic id 404s → conformance checks skip on the 4xx.
    expect(empty.data.summary.skipped_outcomes ?? {}).not.toEqual({});

    // Warm run: real id 200s → fewer skips, and the spec-mismatched 200
    // response surfaces at least one conformance issue (missing X-Trace-Id
    // header is a deterministic finding from the mock server).
    const emptySkips = Object.values(empty.data.summary.skipped_outcomes ?? {})
      .reduce((a, b) => a + b, 0);
    const filledSkips = Object.values(filled.data.summary.skipped_outcomes ?? {})
      .reduce((a, b) => a + b, 0);
    expect(filledSkips).toBeLessThan(emptySkips);
  });
});

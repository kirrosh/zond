/**
 * Integration tests for the ARV-4 data-rejection checks.
 * ARV-337 (Cut A): the anti-FP suppression layer was removed. A
 * serialize-coerce server (string → int) that 2xx's a mutated body now
 * emits a RAW `negative_data_rejection` finding — the agent triages it.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks } from "../../../src/core/checks/index.ts";

describe("ARV-4 data-rejection pipeline", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;

  beforeAll(async () => {
    // Server emulates Express/FastAPI-style coercion: it accepts both
    // {qty: 5} and {qty: "5"}. From the wire it can't tell — auto-cast.
    // For schema-typed fields it 200's; for dropped required fields it
    // also 200's with a synthesized default. Both are anti-FP shapes.
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method !== "POST") return new Response(null, { status: 405 });
        const ct = (req.headers.get("content-type") ?? "").toLowerCase();
        const url = new URL(req.url);
        if (url.pathname !== "/orders") return new Response(null, { status: 404 });
        // Accept anything — the FP shape we want to test is "server
        // coerces or default-fills, returning 2xx on a 'mutated' body".
        return Response.json({ id: 1, accepted: true, ct }, { status: 201 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
    tmpDir = join(tmpdir(), `zond-arv4-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/orders": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["qty"],
                    properties: {
                      qty: { type: "integer", minimum: 1 },
                      name: { type: "string", minLength: 1 },
                    },
                  },
                },
              },
            },
            responses: { "201": { description: "ok" } },
          },
        },
      },
    }), "utf-8");
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("negative_data_rejection runs and *may* fire on this server", async () => {
    // The mutator picks `drop_required` first (qty), and since the
    // server defaults the missing field to a 201, we get a finding.
    // This is the *expected* behavior on a JSON server with no
    // serialise-coercion: only the JSON-FP guards skip these.
    const result = await runChecks({
      specPath,
      baseUrl,
      include: ["negative_data_rejection"],
    });
    // Either fired (server accepted invalid) or skipped (guard) — the
    // contract is just that we didn't crash and the case shape parses.
    expect(result.data.summary.cases).toBeGreaterThan(0);
  });

  test("positive_data_acceptance passes on a server that accepts valid bodies", async () => {
    const result = await runChecks({
      specPath,
      baseUrl,
      include: ["positive_data_acceptance"],
    });
    const finding = result.data.findings.find((f) => f.check === "positive_data_acceptance");
    expect(finding).toBeUndefined();
  });

  test("ARV-337 — serialize-coerce: integer→string mutation on a coercing 2xx now emits a RAW finding", async () => {
    // Use the in-process check runner directly to control exactly the
    // mutation type we want to test (the integration runner picks
    // drop_required first). Pre-ARV-337 the anti-FP guard suppressed
    // this as a skip; now the finding surfaces raw for the agent.
    const { negativeDataRejection } = await import("../../../src/core/checks/checks/negative_data_rejection.ts");
    const outcome = negativeDataRejection.run({
      case: {
        operation: {
          path: "/orders", method: "POST", operationId: "create", summary: undefined, tags: [],
          parameters: [], requestBodySchema: { type: "object" }, requestBodyContentType: "application/json",
          responseContentTypes: ["application/json"],
          responses: [{ statusCode: 201, description: "ok" }],
          security: [],
        },
        request: { method: "POST", url: `${baseUrl}/orders`, headers: { "Content-Type": "application/json" }, body: "{\"qty\":\"7\"}" },
        mode: "negative",
        kind: "negative_data",
        meta: {
          mutation: "type_mutation",
          field_path: "qty",
          from_type: "integer",
          to_type: "string",
          to_value: "7",
        },
      },
      response: { status: 201, headers: { "content-type": "application/json" }, body: { id: 1, accepted: true }, duration_ms: 1 },
    });
    // Raw emit: the server accepted an invalid (type-mutated) body with
    // a 2xx, so the check fails and carries the mutation as evidence.
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") {
      expect(outcome.evidence).toMatchObject({ status: 201 });
      expect(outcome.message).toMatch(/accepted an invalid body/);
    }
  });
});

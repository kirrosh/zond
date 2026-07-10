/**
 * ARV-415: the checks coverage phase creates real resources (a POST body the
 * API accepts) and used to leave them behind — probes self-clean, coverage did
 * not, leaking e.g. an edge-config per run. This locks the parity fix: after a
 * 2xx POST in the coverage phase, zond best-effort DELETEs the self-created id
 * via the resource's DELETE counterpart.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks } from "../../../src/core/checks/index.ts";

describe("ARV-415 coverage-phase cleanup", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;
  let created = 0;
  let deleted: string[] = [];

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        // DELETE /widgets/:id — record the cleanup.
        const delMatch = url.pathname.match(/^\/widgets\/(.+)$/);
        if (req.method === "DELETE" && delMatch) {
          deleted.push(decodeURIComponent(delMatch[1]!));
          return new Response(null, { status: 204 });
        }
        // POST /widgets — accept everything (even out-of-bounds) so coverage
        // boundary cases create a resource, exercising the leak path.
        if (req.method === "POST" && url.pathname === "/widgets") {
          created += 1;
          return Response.json({ id: `w-${created}` }, { status: 201 });
        }
        return new Response(null, { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
    tmpDir = join(tmpdir(), `zond-arv415-${process.pid}`);
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
                    required: ["name"],
                    properties: { name: { type: "string", minLength: 3, maxLength: 8 } },
                  },
                },
              },
            },
            responses: { "201": { description: "created" }, "400": { description: "bad" } },
          },
        },
        "/widgets/{id}": {
          delete: {
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "204": { description: "gone" } },
          },
        },
      },
    }), "utf-8");
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("every resource created by a coverage POST is DELETEd (net count == 0)", async () => {
    created = 0;
    deleted = [];
    await runChecks({
      specPath,
      baseUrl,
      include: ["negative_data_rejection"],
      phase: "coverage",
    });
    // Isolate cleanup DELETEs (of self-created `w-N` ids) from coverage cases
    // that probe the DELETE /widgets/{id} endpoint itself with synthetic ids.
    const cleanupDeletes = deleted.filter(d => d.startsWith("w-"));
    expect(created).toBeGreaterThan(0);              // coverage did create resources
    expect(cleanupDeletes.sort()).toEqual(          // …and cleaned up every one
      Array.from({ length: created }, (_, i) => `w-${i + 1}`),
    );
  });
});

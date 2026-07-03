/**
 * ARV-332 — `checks run --check stateful --include method:GET` must not
 * POST. The stateful CRUD phase used to build groups from the *unfiltered*
 * op set, so `ensure_resource_availability` fired a live POST create even
 * under a read-only scope (leaking a resource on a shared API). The fix
 * builds CRUD groups from the filtered `ops`, so a GET-only scope carries
 * no `create` and the mutating check self-skips.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks } from "../../../src/core/checks/index.ts";
import type { EndpointInfo } from "../../../src/core/generator/types.ts";

describe("ARV-332 — GET-only scope gates stateful create-chains", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;
  let postCount = 0;

  beforeAll(async () => {
    let nextId = 100;
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        if (req.method === "POST" && u.pathname === "/widgets") {
          postCount++;
          return Response.json({ id: nextId++ }, { status: 201 });
        }
        if (req.method === "GET" && /^\/widgets\/\d+$/.test(u.pathname)) {
          return Response.json({ id: Number(u.pathname.split("/").pop()), name: "w" });
        }
        if (req.method === "GET" && u.pathname === "/widgets") {
          return Response.json([]);
        }
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
    tmpDir = join(tmpdir(), `zond-arv332-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/widgets": {
          get: { responses: { "200": { description: "list" } } },
          post: {
            requestBody: {
              content: { "application/json": { schema: {
                type: "object", required: ["name"],
                properties: { name: { type: "string" } },
              } } },
            },
            responses: { "201": { description: "created" } },
          },
        },
        "/widgets/{id}": {
          get: {
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
            responses: { "200": { description: "read" } },
          },
        },
      },
    }), "utf-8");
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("GET-only operationFilter fires no POST (leak gated)", async () => {
    postCount = 0;
    await runChecks({
      specPath,
      baseUrl,
      include: ["ensure_resource_availability"],
      operationFilter: (op: EndpointInfo) => op.method.toUpperCase() === "GET",
    });
    expect(postCount).toBe(0);
  });

  test("control: without the GET-only filter the check does POST", async () => {
    postCount = 0;
    await runChecks({
      specPath,
      baseUrl,
      include: ["ensure_resource_availability"],
    });
    expect(postCount).toBeGreaterThan(0);
  });
});

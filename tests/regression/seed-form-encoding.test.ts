/**
 * ARV-196 — `prepare-fixtures --seed` (and the bootstrap fallback) must
 * post `application/x-www-form-urlencoded` payloads with bracket
 * notation for nested keys when the spec's create endpoint declares
 * that content type. Stripe and friends 400 on JSON bodies, which
 * caused 57/69 broken-baseline findings on cross_call_references in
 * the m-20 review (ARV-193 follow-up).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { bootstrapCommand } from "../../src/cli/commands/bootstrap.ts";

describe("ARV-196 — seed POST honors application/x-www-form-urlencoded with bracket nesting", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let apiDir: string;
  let specPath: string;
  let lastBody: string | null = null;
  let lastContentType: string | null = null;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/v1/customers" && req.method === "POST") {
          lastBody = await req.text();
          lastContentType = req.headers.get("content-type");
          return Response.json({ id: "cus_test_1" }, { status: 200 });
        }
        if (url.pathname === "/v1/customers" && req.method === "GET") {
          return Response.json({ data: [] });
        }
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://127.0.0.1:${server.port}`;

    apiDir = join(tmpdir(), `zond-arv196-${Date.now()}`);
    await mkdir(apiDir, { recursive: true });

    specPath = join(apiDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.3",
      info: { title: "stripe-ish", version: "1" },
      paths: {
        "/v1/customers": {
          get: { responses: { "200": { description: "ok" } } },
          post: {
            requestBody: {
              required: true,
              content: {
                // Key bit under test: form-urlencoded create endpoint.
                "application/x-www-form-urlencoded": {
                  schema: {
                    type: "object",
                    required: ["email"],
                    properties: {
                      email:    { type: "string", example: "alice@example.com" },
                      // Nested object → must serialise as address[line1]=...
                      address: {
                        type: "object",
                        properties: {
                          line1: { type: "string", example: "123 Market St" },
                          city:  { type: "string", example: "SF" },
                        },
                      },
                      // Array of strings → must serialise as
                      // tags[0]=..&tags[1]=.. (Stripe convention).
                      // NB: we deliberately do NOT use `expand` here —
                      // data-factory skips Stripe-style `expand` arrays
                      // for request bodies (see shouldSkipForRequest);
                      // this test is about bracket nesting on the wire,
                      // not about that skip-rule.
                      tags: {
                        type: "array",
                        items: { type: "string", example: "vip" },
                      },
                    },
                  },
                },
              },
            },
            responses: { "200": { description: "ok" } },
          },
        },
      },
    }));

    await writeFile(join(apiDir, ".api-resources.yaml"),
      [
        "resources:",
        "  - resource: customers",
        "    basePath: /v1/customers",
        "    itemPath: /v1/customers/{customer_id}",
        "    idParam: customer_id",
        "    captureField: id",
        "    hasFullCrud: false",
        "    endpoints:",
        "      list: GET /v1/customers",
        "      create: POST /v1/customers",
        "    fkDependencies: []",
        "  - resource: dependents",
        "    basePath: /v1/customers/{customer_id}/sources",
        "    itemPath: \"\"",
        "    idParam: \"\"",
        "    captureField: id",
        "    hasFullCrud: false",
        "    endpoints: {}",
        "    fkDependencies:",
        "      - var: customer_id",
        "        param: customer_id",
        "        in: path",
        "        ownerResource: customers",
        "",
      ].join("\n"));
  });

  afterAll(async () => {
    server?.stop();
    await rm(apiDir, { recursive: true, force: true }).catch(() => {});
  });

  test("seed POST sends form-urlencoded body with address[line1]= bracket nesting", async () => {
    const envPath = join(apiDir, ".env.yaml");
    await writeFile(envPath, `base_url: ${baseUrl}\n`);

    const exit = await bootstrapCommand({
      specPath,
      apiDir,
      envPath,
      apply: true,
      seed: true,
      json: true,
    });
    expect(exit).toBe(0);

    expect(lastContentType).toBeTruthy();
    expect(lastContentType!.toLowerCase()).toContain("application/x-www-form-urlencoded");

    expect(lastBody).toBeTruthy();
    // Top-level field present.
    expect(lastBody!).toContain("email=");
    // Nested object → bracket key on the wire (URL-encoded `[` → `%5B`).
    expect(lastBody!).toMatch(/address(\[|%5B)line1(\]|%5D)=/);
    // Array → indexed bracket (Stripe-style: tags[0]=...).
    expect(lastBody!).toMatch(/tags(\[|%5B)0(\]|%5D)=/);
    // Critically: NOT JSON.
    expect(lastBody!.startsWith("{")).toBe(false);
  });
});

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { bootstrapCommand } from "../../src/cli/commands/bootstrap.ts";

/**
 * Bootstrap covers two situations discover alone can't:
 *  1. cascade — child list-paths only become reachable after the parent
 *     fixture is filled, so a single discover pass leaves them empty;
 *  2. seed — owner has only a create endpoint (or list returns empty), so
 *     we POST a generated body and capture the id.
 */
describe("zond bootstrap", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let apiDir: string;
  let specPath: string;
  // Server state mutated by POST /widgets — confirms idempotency.
  let widgetCreates = 0;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        const m = req.method;
        // Top-level: a single org
        if (url.pathname === "/orgs" && m === "GET") {
          return Response.json([{ slug: "acme" }]);
        }
        // Nested under org → projects.
        if (url.pathname === "/orgs/acme/projects" && m === "GET") {
          return Response.json([{ slug: "frontend", id: 1 }]);
        }
        // Nested under project → keys (still GET).
        if (url.pathname === "/orgs/acme/projects/frontend/keys" && m === "GET") {
          return Response.json({ data: [{ id: "key_99" }] });
        }
        // Empty list — seed candidate.
        if (url.pathname === "/widgets" && m === "GET") {
          return Response.json([]);
        }
        if (url.pathname === "/widgets" && m === "POST") {
          widgetCreates++;
          // Echo back a created id; the body is irrelevant for the test.
          return Response.json({ id: `widget_${widgetCreates}` }, { status: 201 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    tmpDir = join(tmpdir(), `zond-bootstrap-${Date.now()}`);
    apiDir = join(tmpDir, "apis", "demo");
    await mkdir(apiDir, { recursive: true });

    // Spec covers parents + children + the seed-only widgets resource.
    specPath = join(apiDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      paths: {
        "/orgs": { get: { responses: { "200": { description: "ok" } } } },
        "/orgs/{org_slug}/projects": {
          get: {
            parameters: [{ name: "org_slug", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "ok" } },
          },
        },
        "/orgs/{org_slug}/projects/{project_slug}/keys": {
          get: {
            parameters: [
              { name: "org_slug", in: "path", required: true, schema: { type: "string" } },
              { name: "project_slug", in: "path", required: true, schema: { type: "string" } },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
        "/widgets": {
          get: { responses: { "200": { description: "ok" } } },
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["name"],
                    properties: { name: { type: "string", example: "demo-widget" } },
                  },
                },
              },
            },
            responses: { "201": { description: "created" } },
          },
        },
      },
    }));

    // Hand-rolled resource map mirroring what `zond refresh-api` would emit.
    // Three nested-FK consumers (org→project→key) plus a "widgets" resource
    // whose owner has only an empty list — seed candidate.
    await writeFile(join(apiDir, ".api-resources.yaml"),
      [
        "resources:",
        // org list-only (implicit).
        "  - resource: orgs",
        "    basePath: /orgs",
        "    itemPath: \"\"",
        "    idParam: \"\"",
        "    captureField: slug",
        "    hasFullCrud: false",
        "    endpoints:",
        "      list: GET /orgs",
        "    fkDependencies: []",
        // projects list-only nested under org.
        "  - resource: projects",
        "    basePath: /orgs/{org_slug}/projects",
        "    itemPath: \"\"",
        "    idParam: \"\"",
        "    captureField: slug",
        "    hasFullCrud: false",
        "    endpoints:",
        "      list: GET /orgs/{org_slug}/projects",
        "    fkDependencies:",
        "      - var: org_slug",
        "        param: org_slug",
        "        in: path",
        "        ownerResource: orgs",
        // keys list-only nested two levels deep.
        "  - resource: keys",
        "    basePath: /orgs/{org_slug}/projects/{project_slug}/keys",
        "    itemPath: \"\"",
        "    idParam: \"\"",
        "    captureField: id",
        "    hasFullCrud: false",
        "    endpoints:",
        "      list: GET /orgs/{org_slug}/projects/{project_slug}/keys",
        "    fkDependencies:",
        "      - var: org_slug",
        "        param: org_slug",
        "        in: path",
        "        ownerResource: orgs",
        "      - var: project_slug",
        "        param: project_slug",
        "        in: path",
        "        ownerResource: projects",
        // widgets — list returns empty, has create. Tests --seed.
        "  - resource: widgets",
        "    basePath: /widgets",
        "    itemPath: /widgets/{widget_id}",
        "    idParam: widget_id",
        "    captureField: id",
        "    hasFullCrud: false",
        "    endpoints:",
        "      list: GET /widgets",
        "      create: POST /widgets",
        "    fkDependencies: []",
        // consumer of widget_id to make it appear as a target.
        "  - resource: gadgets",
        "    basePath: /gadgets/{widget_id}",
        "    itemPath: \"\"",
        "    idParam: \"\"",
        "    captureField: id",
        "    hasFullCrud: false",
        "    endpoints: {}",
        "    fkDependencies:",
        "      - var: widget_id",
        "        param: widget_id",
        "        in: path",
        "        ownerResource: widgets",
        "",
      ].join("\n"));
  });

  afterAll(async () => {
    server?.stop();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("cascade fills child fixtures across multiple passes", async () => {
    const envPath = join(apiDir, ".env.cascade.yaml");
    await writeFile(envPath, `base_url: ${baseUrl}\n`);

    const exit = await bootstrapCommand({
      specPath,
      apiDir,
      envPath,
      apply: true,
      seed: false,
      json: true,
    });
    expect(exit).toBe(0);

    const after = await readFile(envPath, "utf8");
    // Pass 1 fills org_slug; pass 2 unblocks project_slug; pass 3 unblocks
    // the doubly-nested key list. All three must land in one bootstrap.
    expect(after).toContain(`org_slug: "acme"`);
    expect(after).toContain(`project_slug: "frontend"`);
    // widget_id stays empty without --seed (list is empty, no fallback).
    expect(after).not.toMatch(/^widget_id:\s*"[^"]+"\s*$/m);

    // .bak created.
    const backup = await readFile(`${envPath}.bak`, "utf8");
    expect(backup).toBe(`base_url: ${baseUrl}\n`);
  });

  test("--seed POSTs to create endpoint when discover can't find a record", async () => {
    widgetCreates = 0;
    const envPath = join(apiDir, ".env.seed.yaml");
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
    expect(widgetCreates).toBe(1);

    const after = await readFile(envPath, "utf8");
    expect(after).toMatch(/widget_id:\s*"widget_1"/);
  });

  test("idempotency: second run does not POST again or overwrite fixtures", async () => {
    widgetCreates = 0;
    const envPath = join(apiDir, ".env.idempotent.yaml");
    // Pre-populate everything as if a prior bootstrap had run.
    await writeFile(envPath,
      `base_url: ${baseUrl}\n` +
      `org_slug: "acme"\n` +
      `project_slug: "frontend"\n` +
      `widget_id: "widget_existing"\n`,
    );

    const exit = await bootstrapCommand({
      specPath,
      apiDir,
      envPath,
      apply: true,
      seed: true,
      json: true,
    });
    expect(exit).toBe(0);
    expect(widgetCreates).toBe(0);

    const after = await readFile(envPath, "utf8");
    expect(after).toMatch(/widget_id:\s*"widget_existing"/);
    expect(after).toMatch(/org_slug:\s*"acme"/);
  });

  test("--force re-discovers existing values", async () => {
    const envPath = join(apiDir, ".env.force.yaml");
    await writeFile(envPath,
      `base_url: ${baseUrl}\n` +
      `org_slug: "stale-value"\n`,
    );

    const exit = await bootstrapCommand({
      specPath,
      apiDir,
      envPath,
      apply: true,
      force: true,
      json: true,
    });
    expect(exit).toBe(0);

    const after = await readFile(envPath, "utf8");
    expect(after).toContain(`org_slug: "acme"`);
    expect(after).not.toContain("stale-value");
  });

  test("missing base_url returns exit 2", async () => {
    const envPath = join(apiDir, ".env.nobase.yaml");
    await writeFile(envPath, "auth_token: abc\n");

    const exit = await bootstrapCommand({
      specPath,
      apiDir,
      envPath,
      json: true,
    });
    expect(exit).toBe(2);
  });
});

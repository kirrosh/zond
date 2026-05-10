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

  // TASK-271: per-target classification + stop reason + plan/exec marker.
  test("--apply on already-filled fixtures: noOp=true, mode=exec, all already", async () => {
    const envPath = join(apiDir, ".env.task271.noop.yaml");
    await writeFile(envPath,
      `base_url: ${baseUrl}\n` +
      `org_slug: "acme"\n` +
      `project_slug: "frontend"\n` +
      `widget_id: "widget_existing"\n`,
    );

    // Capture the JSON envelope by mocking stdout.
    const origWrite = process.stdout.write;
    const chunks: string[] = [];
    process.stdout.write = ((c: unknown) => { chunks.push(typeof c === "string" ? c : String(c)); return true; }) as typeof process.stdout.write;
    let exit: number;
    try {
      exit = await bootstrapCommand({ specPath, apiDir, envPath, apply: true, seed: true, json: true });
    } finally {
      process.stdout.write = origWrite;
    }
    expect(exit).toBe(0);
    const out = JSON.parse(chunks.join(""));
    expect(out.data.mode).toBe("exec");
    expect(out.data.summary.noOp).toBe(true);
    expect(out.data.summary.cascadeStop).toBeDefined();
    // Every target classified as `already`.
    expect(out.data.perTarget.length).toBeGreaterThan(0);
    expect(out.data.perTarget.every((t: { status: string }) => t.status === "already")).toBe(true);
  });

  test("dry-run on empty env: mode=plan, applied=false, perTarget reflects discovered/seeded", async () => {
    widgetCreates = 0;
    const envPath = join(apiDir, ".env.task271.plan.yaml");
    await writeFile(envPath, `base_url: ${baseUrl}\n`);

    const origWrite = process.stdout.write;
    const chunks: string[] = [];
    process.stdout.write = ((c: unknown) => { chunks.push(typeof c === "string" ? c : String(c)); return true; }) as typeof process.stdout.write;
    let exit: number;
    try {
      exit = await bootstrapCommand({ specPath, apiDir, envPath, apply: false, seed: true, json: true });
    } finally {
      process.stdout.write = origWrite;
    }
    expect(exit).toBe(0);
    const out = JSON.parse(chunks.join(""));
    expect(out.data.mode).toBe("plan");
    expect(out.data.applied).toBe(false);
    expect(out.data.summary.noOp).toBe(false);
    // org_slug should land via discover, widget_id via seed.
    const byVar = Object.fromEntries(out.data.perTarget.map((t: { var: string; status: string }) => [t.var, t.status]));
    expect(byVar.org_slug).toBe("discovered");
    expect(byVar.widget_id).toBe("seeded");
  });

  // ARV-47: --seed POSTs a spec-aware body that pulls parent-FK ids from
  // .env.yaml (audience_id from env), so the live API actually accepts it.
  // Without this fix, generated body had a random UUID and APIs 422'd.
  test("--seed substitutes FK fields from env (ARV-47); 422 surfaces miss-seed-422 + repro", async () => {
    const arvDir = join(tmpDir, "apis", "arv47");
    await mkdir(arvDir, { recursive: true });
    let lastBody: { audience_id?: string; name?: string } | null = null;
    const arv = Bun.serve({
      port: 0,
      async fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/audiences" && req.method === "GET") {
          // Owner resource list — used by cascade to confirm audience_id discovery.
          return Response.json([{ id: "aud_real_42" }]);
        }
        if (u.pathname === "/contacts" && req.method === "GET") {
          // Empty list — forces seed.
          return Response.json([]);
        }
        if (u.pathname === "/contacts" && req.method === "POST") {
          lastBody = (await req.json()) as { audience_id?: string; name?: string };
          // 422 when audience_id doesn't match the magic value (mimics
          // "audience aud_xxx not found" on a real tenant).
          if (lastBody.audience_id !== "aud_real_42") {
            return Response.json(
              { detail: "audience not found" },
              { status: 422 },
            );
          }
          return Response.json({ id: "ct_new" }, { status: 201 });
        }
        if (u.pathname === "/baddies" && req.method === "GET") return Response.json([]);
        if (u.pathname === "/baddies" && req.method === "POST") {
          return Response.json(
            { detail: "validation failed: bad_id missing" },
            { status: 422 },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    const arvBaseUrl = `http://localhost:${arv.port}`;
    const arvSpec = join(arvDir, "spec.json");
    await writeFile(arvSpec, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "arv", version: "1" },
      paths: {
        "/audiences": { get: { responses: { "200": {} } } },
        "/contacts": {
          get: { responses: { "200": {} } },
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["audience_id", "name"],
                    properties: {
                      audience_id: { type: "string", format: "uuid" },
                      name: { type: "string" },
                    },
                  },
                },
              },
            },
            responses: { "201": {} },
          },
        },
        "/baddies": {
          get: { responses: { "200": {} } },
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["nope"],
                    properties: { nope: { type: "string" } },
                  },
                },
              },
            },
            responses: { "201": {} },
          },
        },
      },
    }));
    await writeFile(join(arvDir, ".api-resources.yaml"),
      [
        "resources:",
        "  - resource: audiences",
        "    basePath: /audiences",
        "    itemPath: \"\"",
        "    idParam: \"\"",
        "    captureField: id",
        "    hasFullCrud: false",
        "    endpoints:",
        "      list: GET /audiences",
        "    fkDependencies: []",
        "  - resource: contacts",
        "    basePath: /contacts",
        "    itemPath: /contacts/{contact_id}",
        "    idParam: contact_id",
        "    captureField: id",
        "    hasFullCrud: false",
        "    endpoints:",
        "      list: GET /contacts",
        "      create: POST /contacts",
        "    fkDependencies:",
        "      - var: audience_id",
        "        param: audience_id",
        "        in: body",
        "        ownerResource: audiences",
        "  - resource: baddies",
        "    basePath: /baddies",
        "    itemPath: /baddies/{bad_id}",
        "    idParam: bad_id",
        "    captureField: id",
        "    hasFullCrud: false",
        "    endpoints:",
        "      list: GET /baddies",
        "      create: POST /baddies",
        "    fkDependencies: []",
        // Pretend a downstream consumer needs both contact_id and bad_id so
        // they enter the target list.
        "  - resource: things",
        "    basePath: /things",
        "    itemPath: \"\"",
        "    idParam: \"\"",
        "    captureField: id",
        "    hasFullCrud: false",
        "    endpoints: {}",
        "    fkDependencies:",
        "      - var: contact_id",
        "        param: contact_id",
        "        in: path",
        "        ownerResource: contacts",
        "      - var: bad_id",
        "        param: bad_id",
        "        in: path",
        "        ownerResource: baddies",
        "",
      ].join("\n"));
    const envPath = join(arvDir, ".env.yaml");
    // audience_id pre-filled — seed should substitute it into POST /contacts.
    await writeFile(envPath, `base_url: ${arvBaseUrl}\naudience_id: aud_real_42\n`);

    const origStdout = process.stdout.write;
    let captured = "";
    process.stdout.write = ((chunk: unknown) => {
      captured += typeof chunk === "string" ? chunk : String(chunk);
      return true;
    }) as typeof process.stdout.write;
    let exit: number;
    try {
      exit = await bootstrapCommand({
        specPath: arvSpec,
        apiDir: arvDir,
        envPath,
        apply: true,
        seed: true,
        json: true,
      });
    } finally {
      process.stdout.write = origStdout;
      arv.stop();
    }
    expect(exit).toBe(0);

    // 1. audience_id from env was substituted into the seed POST body —
    //    not a random UUID — proving buildCreateRequestBody's FK swap works.
    expect(lastBody?.audience_id).toBe("aud_real_42");

    // 2. /baddies seed got a 422 → status miss-seed-422 + repro present.
    const out = JSON.parse(captured);
    const seeds = out.data.seeds as Array<{
      varName: string;
      status: string;
      reason?: string;
      repro?: string;
    }>;
    const bad = seeds.find(s => s.varName === "bad_id");
    expect(bad).toBeDefined();
    expect(bad!.status).toBe("miss-seed-422");
    expect(bad!.reason).toMatch(/422/);
    // detail extraction surfaces FastAPI-style validation messages.
    expect(bad!.reason).toMatch(/validation failed/);
    expect(bad!.repro).toMatch(/^curl -X POST/);
    expect(bad!.repro).toContain("/baddies");
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

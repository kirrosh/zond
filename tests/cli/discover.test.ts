import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { discoverCommand } from "../../src/cli/commands/discover.ts";

describe("zond discover", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;
  let apiDir: string;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/audiences") {
          return Response.json([
            { id: "aud_real_42", name: "Marketing" },
            { id: "aud_real_99", name: "Sales" },
          ]);
        }
        if (url.pathname === "/projects") {
          return Response.json({ data: [{ slug: "proj-zond", id: 7 }] });
        }
        if (url.pathname === "/empty") {
          return Response.json([]);
        }
        if (url.pathname === "/forbidden") {
          return new Response("nope", { status: 403 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    tmpDir = join(tmpdir(), `zond-discover-${Date.now()}`);
    apiDir = join(tmpDir, "apis", "demo");
    await mkdir(apiDir, { recursive: true });

    // Minimal OpenAPI spec covering the list endpoints.
    specPath = join(apiDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      paths: {
        "/audiences": { get: { responses: { "200": { description: "ok" } } } },
        "/projects": { get: { responses: { "200": { description: "ok" } } } },
        "/empty": { get: { responses: { "200": { description: "ok" } } } },
        "/forbidden": { get: { responses: { "200": { description: "ok" } } } },
        "/contacts": {
          post: { responses: { "201": { description: "created" } } },
        },
        "/contacts/{contact_id}": {
          get: { responses: { "200": { description: "ok" } } },
        },
        "/orphan": {
          post: { responses: { "201": { description: "created" } } },
        },
        "/orphan/{orphan_id}": {
          get: { responses: { "200": { description: "ok" } } },
        },
      },
    }));

    // Hand-crafted resources map: `contacts` consumes `audience_id` (resolves
    // via /audiences), and a fake resource consuming `project_slug` whose
    // owner is /projects.
    await writeFile(join(apiDir, ".api-resources.yaml"),
      [
        "resources:",
        "  - resource: audiences",
        "    basePath: /audiences",
        "    itemPath: /audiences/{audience_id}",
        "    idParam: audience_id",
        "    captureField: id",
        "    hasFullCrud: false",
        "    endpoints:",
        "      list: GET /audiences",
        "    fkDependencies: []",
        "  - resource: projects",
        "    basePath: /projects",
        "    itemPath: /projects/{project_slug}",
        "    idParam: project_slug",
        "    captureField: slug",
        "    hasFullCrud: false",
        "    endpoints:",
        "      list: GET /projects",
        "    fkDependencies: []",
        "  - resource: empties",
        "    basePath: /empty",
        "    itemPath: /empty/{empty_id}",
        "    idParam: empty_id",
        "    captureField: id",
        "    hasFullCrud: false",
        "    endpoints:",
        "      list: GET /empty",
        "    fkDependencies: []",
        "  - resource: forbiddens",
        "    basePath: /forbidden",
        "    itemPath: /forbidden/{forbidden_id}",
        "    idParam: forbidden_id",
        "    captureField: id",
        "    hasFullCrud: false",
        "    endpoints:",
        "      list: GET /forbidden",
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
        "        in: path",
        "        ownerResource: audiences",
        "      - var: project_slug",
        "        param: project_slug",
        "        in: path",
        "        ownerResource: projects",
        "      - var: empty_id",
        "        param: empty_id",
        "        in: path",
        "        ownerResource: empties",
        "      - var: forbidden_id",
        "        param: forbidden_id",
        "        in: path",
        "        ownerResource: forbiddens",
        "",
      ].join("\n"));
  });

  afterAll(async () => {
    server?.stop();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("dry-run reports writes/misses without modifying .env.yaml", async () => {
    const envPath = join(apiDir, ".env.dry.yaml");
    await writeFile(envPath, `base_url: ${baseUrl}\n`);

    const exit = await discoverCommand({
      specPath,
      apiDir,
      envPath,
      apply: false,
      json: true,
    });
    expect(exit).toBe(0);

    const after = await readFile(envPath, "utf8");
    // Untouched in dry-run.
    expect(after).toBe(`base_url: ${baseUrl}\n`);
  });

  test("--apply writes discovered ids and creates a backup", async () => {
    const envPath = join(apiDir, ".env.apply.yaml");
    await writeFile(envPath, `base_url: ${baseUrl}\naudience_id: ""\n`);

    const exit = await discoverCommand({
      specPath,
      apiDir,
      envPath,
      apply: true,
      json: true,
    });
    expect(exit).toBe(0);

    const after = await readFile(envPath, "utf8");
    expect(after).toContain(`audience_id: "aud_real_42"`);
    // Project slug discovered via { data: [{slug}] } shape.
    expect(after).toContain(`project_slug: "proj-zond"`);
    // empty list — no value written, env should not contain a non-empty empty_id.
    expect(after).not.toMatch(/^empty_id:\s*"[^"]+"\s*$/m);
    // forbidden — 403; no value written.
    expect(after).not.toMatch(/^forbidden_id:\s*"[^"]+"\s*$/m);

    // Backup exists and equals the pre-apply content.
    const backup = await readFile(`${envPath}.bak`, "utf8");
    expect(backup).toBe(`base_url: ${baseUrl}\naudience_id: ""\n`);
  });

  test("skips vars already filled with a non-placeholder value", async () => {
    const envPath = join(apiDir, ".env.skip.yaml");
    await writeFile(envPath, `base_url: ${baseUrl}\naudience_id: pre_set_value\n`);

    const exit = await discoverCommand({
      specPath,
      apiDir,
      envPath,
      apply: true,
      json: true,
    });
    expect(exit).toBe(0);

    const after = await readFile(envPath, "utf8");
    // Existing value preserved — discover did NOT overwrite a real fixture.
    expect(after).toMatch(/audience_id:\s*pre_set_value/);
  });

  // TASK-273 — empty list-response on a fresh target API gets miss-empty +
  // a hint pointing at "create one first" instead of the cryptic miss-no-id.
  test("empty list response → miss-empty with create-one-first hint", async () => {
    const envPath = join(apiDir, ".env.empty.yaml");
    await writeFile(envPath, `base_url: ${baseUrl}\n`);

    const origWrite = process.stdout.write;
    let captured = "";
    process.stdout.write = ((chunk: unknown) => {
      captured += typeof chunk === "string" ? chunk : String(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      const exit = await discoverCommand({
        specPath,
        apiDir,
        envPath,
        apply: false,
        json: true,
      });
      expect(exit).toBe(0);
    } finally {
      process.stdout.write = origWrite;
    }

    const env = JSON.parse(captured);
    const empty = env.data.items.find((i: { varName: string }) => i.varName === "empty_id");
    expect(empty.status).toBe("miss-empty");
    expect(empty.reason).toMatch(/no empties in target API/);
    expect(empty.reason).toMatch(/create one first/);
  });

  test("missing base_url returns exit 2", async () => {
    const envPath = join(apiDir, ".env.nobase.yaml");
    await writeFile(envPath, "auth_token: abc\n");

    const exit = await discoverCommand({
      specPath,
      apiDir,
      envPath,
      apply: false,
      json: true,
    });
    expect(exit).toBe(2);
  });
});

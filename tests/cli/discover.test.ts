import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { discoverCommand } from "../../src/cli/commands/discover.ts";
import { captureOutput } from "../_helpers/output.ts";

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

  // ARV-362 (m-25): discover never writes values — which record/field fills a
  // slot is the agent's call. --apply (outside --verify) leaves .env.yaml
  // untouched and reports every unfilled var as a gap.
  test("--apply does not write values — reports non-empty lists as needs-value gaps", async () => {
    const envPath = join(apiDir, ".env.apply.yaml");
    const before = `base_url: ${baseUrl}\naudience_id: ""\n`;
    await writeFile(envPath, before);

    const out = captureOutput({ console: true });
    const exit = await discoverCommand({
      specPath,
      apiDir,
      envPath,
      apply: true,
      json: true,
    });
    expect(exit).toBe(0);

    // .env.yaml untouched — no harvested value, no backup.
    const after = await readFile(envPath, "utf8");
    expect(after).toBe(before);

    const env = JSON.parse(out.out);
    expect(env.data.applied).toBe(false);
    const byVar = (n: string) =>
      env.data.items.find((i: { varName: string }) => i.varName === n);
    // Non-empty lists → miss-needs-value (agent picks), not a write.
    expect(byVar("audience_id").status).toBe("miss-needs-value");
    expect(byVar("project_slug").status).toBe("miss-needs-value");
    // No item is ever a write anymore.
    expect(env.data.items.some((i: { status: string }) => i.status === "write")).toBe(false);
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
    // ARV-336: prepare-fixtures is single-pass and never POST-creates. The
    // hint tells the tester to create the record by hand and harvest its id.
    expect(empty.reason).toMatch(/create the resource yourself/);
    expect(empty.reason).toMatch(/fixtures add/);

    // TASK-294: every miss-* item carries a recommended_action for agent routing.
    type Item = { varName: string; status: string; recommended_action?: string };
    const items = env.data.items as Item[];
    const misses = items.filter(i => i.status.startsWith("miss-"));
    expect(misses.length).toBeGreaterThan(0);
    for (const i of misses) {
      const expected = i.status === "miss-network" ? "fix_network_config" : "fix_fixture";
      expect(i.recommended_action).toBe(expected);
    }
  });

  // ARV-46: when .api-fixtures.yaml is present, discover iterates the
  // manifest (not env keys / FK deps) and surfaces every entry — including
  // env keys without a manifest entry, which become a warning.
  test("manifest-driven discover: one row per manifest entry + unknown-env-key warning", async () => {
    const mfDir = join(tmpDir, "apis", "demo-mf");
    await mkdir(mfDir, { recursive: true });
    await writeFile(join(mfDir, "spec.json"), JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo-mf", version: "1" },
      paths: {
        "/audiences": { get: { responses: { "200": { description: "ok" } } } },
        "/audiences/{audience_id}": {
          get: { parameters: [{ name: "audience_id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } },
        },
      },
    }));
    await writeFile(join(mfDir, ".api-resources.yaml"),
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
        "",
      ].join("\n"));
    await writeFile(join(mfDir, ".api-fixtures.yaml"),
      [
        "fixtures:",
        "  - name: base_url",
        "    source: server",
        "    required: true",
        "    description: server",
        "    affectedEndpoints: ['*']",
        "  - name: auth_token",
        "    source: auth",
        "    required: true",
        "    description: bearer",
        "    affectedEndpoints: []",
        "  - name: audience_id",
        "    source: path",
        "    required: true",
        "    description: path param",
        "    affectedEndpoints: ['GET /audiences/{audience_id}']",
        "  - name: capture_var",
        "    source: capture-chain",
        "    required: false",
        "    description: chain var",
        "    affectedEndpoints: []",
        "",
      ].join("\n"));

    const envPath = join(mfDir, ".env.yaml");
    // Note: legacy_var is present in env but not in manifest → must surface
    // as unknownEnvKeys.
    await writeFile(envPath, `base_url: ${baseUrl}\nlegacy_var: leftover\n`);

    const origWrite = process.stdout.write;
    let captured = "";
    process.stdout.write = ((chunk: unknown) => {
      captured += typeof chunk === "string" ? chunk : String(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      const exit = await discoverCommand({
        specPath: join(mfDir, "spec.json"),
        apiDir: mfDir,
        envPath,
        apply: false,
        json: true,
      });
      expect(exit).toBe(0);
    } finally {
      process.stdout.write = origWrite;
    }

    const env = JSON.parse(captured);
    const items = env.data.items as Array<{ varName: string; manifestStatus?: string; manifestSource?: string }>;
    // AC#4: one row per manifest entry (4 entries here).
    expect(items.length).toBe(4);
    const byName = Object.fromEntries(items.map(i => [i.varName, i]));
    expect(byName.base_url!.manifestStatus).toBe("skipped:not-required");
    expect(byName.auth_token!.manifestStatus).toBe("skipped:not-required");
    // ARV-362: audience_id list /audiences responds with records, but discover
    // won't pick one — the agent fills it. Reported as failed:needs-value.
    expect(byName.audience_id!.manifestStatus).toBe("failed:needs-value");
    // capture-chain entries are not the discover loop's responsibility.
    expect(byName.capture_var!.manifestStatus).toBe("skipped:not-required");
    // ARV-362: discover never auto-fills → filled = 0, required (manifest) = 3.
    expect(env.data.summary.manifest).toBeDefined();
    expect(env.data.summary.manifest.required).toBe(3);
    expect(env.data.summary.manifest.filled).toBe(0);
    expect(env.data.summary.manifest.unknownEnvKeys).toContain("legacy_var");
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

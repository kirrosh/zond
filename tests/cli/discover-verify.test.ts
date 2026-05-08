import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { discoverCommand } from "../../src/cli/commands/discover.ts";

// TASK-281: --verify GETs each fixture's read-by-id endpoint and classifies
// the result. --refresh = --verify --apply: stale ids are dropped and re-
// resolved through the regular discover flow.

describe("zond discover --verify (TASK-281)", () => {
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
        const path = url.pathname;

        // List endpoints — always return one item so refresh re-resolves.
        if (path === "/audiences") {
          return Response.json([{ id: "aud_real_42", name: "Marketing" }]);
        }
        if (path === "/teams") {
          return Response.json([{ id: "team_fresh_1", name: "Fresh" }]);
        }

        // Read-by-id — drives verify classification.
        if (path === "/audiences/aud_real_42") return Response.json({ id: "aud_real_42" });
        if (path === "/audiences/aud_stale_999") return new Response("gone", { status: 404 });
        if (path === "/teams/team_real_7") return Response.json({ id: "team_real_7" });
        if (path === "/teams/team_flake") return new Response("oops", { status: 503 });

        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    tmpDir = join(tmpdir(), `zond-discover-verify-${Date.now()}`);
    apiDir = join(tmpDir, "apis", "demo");
    await mkdir(apiDir, { recursive: true });

    specPath = join(apiDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      paths: {
        "/audiences": { get: { responses: { "200": { description: "ok" } } } },
        "/audiences/{audience_id}": { get: { responses: { "200": { description: "ok" } } } },
        "/teams": { get: { responses: { "200": { description: "ok" } } } },
        "/teams/{team_id}": { get: { responses: { "200": { description: "ok" } } } },
        "/contacts": { post: { responses: { "201": { description: "created" } } } },
      },
    }));

    await writeFile(join(apiDir, ".api-resources.yaml"), [
      "resources:",
      "  - resource: audiences",
      "    basePath: /audiences",
      "    itemPath: /audiences/{audience_id}",
      "    idParam: audience_id",
      "    captureField: id",
      "    hasFullCrud: false",
      "    endpoints:",
      "      list: GET /audiences",
      "      read: GET /audiences/{audience_id}",
      "    fkDependencies: []",
      "  - resource: teams",
      "    basePath: /teams",
      "    itemPath: /teams/{team_id}",
      "    idParam: team_id",
      "    captureField: id",
      "    hasFullCrud: false",
      "    endpoints:",
      "      list: GET /teams",
      "      read: GET /teams/{team_id}",
      "    fkDependencies: []",
      "  - resource: contacts",
      "    basePath: /contacts",
      "    itemPath: /contacts/{contact_id}",
      "    idParam: contact_id",
      "    captureField: id",
      "    hasFullCrud: false",
      "    endpoints:",
      "      create: POST /contacts",
      "    fkDependencies:",
      "      - var: audience_id",
      "        param: audience_id",
      "        in: path",
      "        ownerResource: audiences",
      "      - var: team_id",
      "        param: team_id",
      "        in: path",
      "        ownerResource: teams",
      "",
    ].join("\n"));
  });

  afterAll(async () => {
    server?.stop();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("--verify alone classifies live/stale/unknown without writing", async () => {
    const envPath = join(apiDir, ".env.verify-dryrun.yaml");
    await writeFile(envPath, [
      `base_url: ${baseUrl}`,
      `audience_id: aud_real_42`,
      `team_id: team_flake`,
      ``,
    ].join("\n"));

    const before = await readFile(envPath, "utf8");
    const exit = await discoverCommand({ specPath, apiDir, envPath, verify: true, apply: false, json: true });
    expect(exit).toBe(0);

    // File untouched.
    const after = await readFile(envPath, "utf8");
    expect(after).toBe(before);
  });

  test("--refresh drops stale id and re-resolves it via list endpoint", async () => {
    const envPath = join(apiDir, ".env.refresh.yaml");
    await writeFile(envPath, [
      `base_url: ${baseUrl}`,
      `audience_id: aud_stale_999`, // 404 on read-by-id → stale
      `team_id: team_real_7`,        // 200 → live, kept as-is
      ``,
    ].join("\n"));

    const exit = await discoverCommand({ specPath, apiDir, envPath, verify: true, apply: true, json: true });
    expect(exit).toBe(0);

    const after = await readFile(envPath, "utf8");
    expect(after).toContain(`audience_id: "aud_real_42"`); // re-resolved via list
    expect(after).not.toContain(`aud_stale_999`);
    // team_id was live → not touched (still raw, not JSON-quoted by upsertEnvLine).
    expect(after).toMatch(/team_id:\s*team_real_7/);
  });

  test("5xx on read-by-id is classified unknown — fixture is preserved", async () => {
    const envPath = join(apiDir, ".env.flake.yaml");
    await writeFile(envPath, [
      `base_url: ${baseUrl}`,
      `team_id: team_flake`, // server returns 503
      ``,
    ].join("\n"));

    const exit = await discoverCommand({ specPath, apiDir, envPath, verify: true, apply: true, json: true });
    expect(exit).toBe(0);

    // 503 → unknown → fixture is NOT dropped, even with --apply.
    const after = await readFile(envPath, "utf8");
    expect(after).toMatch(/team_id:\s*team_flake/);
  });
});

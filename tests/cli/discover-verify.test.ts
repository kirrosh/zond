import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { discoverCommand } from "../../src/cli/commands/discover.ts";
import { captureOutput } from "../_helpers/output.ts";

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

  // ARV-142: --refresh used to report "0 stale" while quietly overwriting on
  // disk because the verify-stale item was replaced by the write-outcome before
  // counting. Summary must surface stale_fixed/still_stale counters.
  test("--refresh summary reports stale_fixed>=1 after re-resolving a stale id", async () => {
    const envPath = join(apiDir, ".env.refresh-counter.yaml");
    await writeFile(envPath, [
      `base_url: ${baseUrl}`,
      `audience_id: aud_stale_999`,
      ``,
    ].join("\n"));

    const out = captureOutput({ console: true });
    const exit = await discoverCommand({ specPath, apiDir, envPath, verify: true, apply: true, json: true });
    expect(exit).toBe(0);
    const env = JSON.parse(out.out);
    expect(env.ok).toBe(true);
    expect(env.data.summary.verify.stale_fixed).toBeGreaterThanOrEqual(1);
    // After successful refresh, currently-stale count drops to 0.
    expect(env.data.summary.verify.stale).toBe(0);
    expect(env.data.summary.verify.still_stale).toBe(0);
  });

  // ARV-143: filled vars without a read-by-id endpoint used to be invisible
  // in refresh output (silent miss). Now they appear under user_config so
  // doctor (set:true) and refresh agree.
  test("--refresh surfaces filled user-config vars under trusted bucket", async () => {
    const envPath = join(apiDir, ".env.user-config.yaml");
    const manifestPath = join(apiDir, ".api-fixtures.yaml");
    // Write a manifest with an auth-source var; the resource map already
    // exists from beforeAll, but the manifest is per-test.
    await writeFile(manifestPath, [
      "fixtures:",
      "  - name: api_token",
      "    source: auth",
      "    required: true",
      "  - name: audience_id",
      "    source: path",
      "    required: true",
      "",
    ].join("\n"));
    await writeFile(envPath, [
      `base_url: ${baseUrl}`,
      `api_token: secret-abc`,
      `audience_id: aud_real_42`,
      ``,
    ].join("\n"));

    const out = captureOutput({ console: true });
    const exit = await discoverCommand({ specPath, apiDir, envPath, verify: true, apply: true, json: true });
    expect(exit).toBe(0);
    const env = JSON.parse(out.out);
    expect(env.data.summary.verify.user_config).toBe(1);
    // Item is present with the new status so the table renders it.
    const item = (env.data.items as Array<{ varName: string; status: string }>)
      .find(i => i.varName === "api_token");
    expect(item?.status).toBe("verify-user-config");
    await rm(manifestPath, { force: true });
  });

  // ARV-143 follow-up (security regression): the verify-user-config bucket
  // must NEVER echo the raw value to stdout or to the JSON envelope —
  // auth_token / api_key from `.env.yaml` are sensitive (Sentry pattern
  // `auth_token: sntryu_...`). Same redaction contract doctor uses for
  // `.secrets.yaml`-resolved entries.
  test("--refresh redacts user-config secret values in text and JSON", async () => {
    const envPath = join(apiDir, ".env.secret-leak.yaml");
    const manifestPath = join(apiDir, ".api-fixtures.yaml");
    const tokenValue = "sntryu_supersecretvalue1234567890abcdef";
    await writeFile(manifestPath, [
      "fixtures:",
      "  - name: auth_token",
      "    source: auth",
      "    required: true",
      "  - name: audience_id",
      "    source: path",
      "    required: true",
      "",
    ].join("\n"));
    await writeFile(envPath, [
      `base_url: ${baseUrl}`,
      `auth_token: ${tokenValue}`,
      `audience_id: aud_real_42`,
      ``,
    ].join("\n"));

    // JSON path — items[].current for the auth_token row must not carry the
    // raw token (registry redacts to `<redacted:auth_token>`).
    {
      const out = captureOutput({ console: true });
      const exit = await discoverCommand({ specPath, apiDir, envPath, verify: true, apply: true, json: true });
      expect(exit).toBe(0);
      expect(out.out).not.toContain(tokenValue);
      const env = JSON.parse(out.out);
      const item = (env.data.items as Array<{ varName: string; current?: string }>)
        .find(i => i.varName === "auth_token");
      expect(item?.current).not.toBe(tokenValue);
    }
    // Text path — the trusted row must render length-only, not the value.
    {
      const out = captureOutput({ console: true });
      const exit = await discoverCommand({ specPath, apiDir, envPath, verify: true, apply: true, json: false });
      expect(exit).toBe(0);
      expect(out.out).not.toContain(tokenValue);
      expect(out.err).not.toContain(tokenValue);
      expect(out.out).toMatch(/\(trusted, length=\d+\)/);
    }
    await rm(manifestPath, { force: true });
  });

  test("--refresh text summary surfaces stale-fixed in addition to stale", async () => {
    const envPath = join(apiDir, ".env.refresh-text.yaml");
    await writeFile(envPath, [
      `base_url: ${baseUrl}`,
      `audience_id: aud_stale_999`,
      ``,
    ].join("\n"));

    const out = captureOutput({ console: true });
    const exit = await discoverCommand({ specPath, apiDir, envPath, verify: true, apply: true, json: false });
    expect(exit).toBe(0);
    expect(out.out).toMatch(/Verify summary:.*stale-fixed/);
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

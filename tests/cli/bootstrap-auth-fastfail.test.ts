/**
 * ARV-326: prepare-fixtures --cascade against a dead/scoped-wrong token must
 * abort after ~AUTH_ABORT_MIN_PROBES discovery probes instead of grinding
 * through every resource (92 on Stripe) collecting identical 401s.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { bootstrapCommand } from "../../src/cli/commands/bootstrap.ts";

const RESOURCES = 15;

describe("bootstrap auth fast-fail (ARV-326)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let apiDir: string;
  let specPath: string;
  let hits = 0;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        hits++;
        return Response.json({ error: "invalid api key" }, { status: 401 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    tmpDir = join(tmpdir(), `zond-arv326-${Date.now()}`);
    apiDir = join(tmpDir, "apis", "demo");
    await mkdir(apiDir, { recursive: true });

    const paths: Record<string, unknown> = {};
    const resources: string[] = ["resources:"];
    for (let i = 0; i < RESOURCES; i++) {
      paths[`/r${i}`] = { get: { responses: { "200": { description: "ok" } } } };
      resources.push(
        `  - resource: r${i}`,
        `    basePath: /r${i}`,
        `    itemPath: ""`,
        `    idParam: ""`,
        `    captureField: id`,
        `    hasFullCrud: false`,
        `    endpoints:`,
        `      list: GET /r${i}`,
        `    fkDependencies: []`,
        `  - resource: c${i}`,
        `    basePath: /c${i}/{r${i}_id}`,
        `    itemPath: ""`,
        `    idParam: ""`,
        `    captureField: id`,
        `    hasFullCrud: false`,
        `    endpoints: {}`,
        `    fkDependencies:`,
        `      - var: r${i}_id`,
        `        param: r${i}_id`,
        `        in: path`,
        `        ownerResource: r${i}`,
      );
    }
    specPath = join(apiDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0", info: { title: "demo", version: "1" }, paths,
    }));
    await writeFile(join(apiDir, ".api-resources.yaml"), resources.join("\n") + "\n");
  });

  afterAll(async () => {
    server?.stop();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("cascade aborts early once a majority of probes return 401", async () => {
    hits = 0;
    const envPath = join(apiDir, ".env.yaml");
    await writeFile(envPath, `base_url: ${baseUrl}\n`);

    const exit = await bootstrapCommand({
      specPath,
      apiDir,
      envPath,
      apply: true,
      seed: true, // must also be skipped — a token that can't LIST won't POST
      json: true,
    });
    expect(exit).toBe(0);

    // Fast-fail: 10 probes (AUTH_ABORT_MIN_PROBES), not all 15 resources —
    // and no seed POSTs on top.
    expect(hits).toBeLessThan(RESOURCES);
    expect(hits).toBe(10);
  });
});

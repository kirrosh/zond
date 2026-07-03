/**
 * ARV-327: `prepare-fixtures --seed` must not fire a child resource's
 * create-POST before its parent is resolved, even when the child happens
 * to be listed before the parent in `.api-resources.yaml` (arbitrary spec
 * order — nothing guarantees parents come first). `cards` requires
 * `account_id` (a required body-FK field) but is listed BEFORE `accounts`
 * in the fixture below; without topological ordering (ARV-327) the first
 * (and, with maxPasses=1, only) outer seed pass would attempt `cards`
 * while `account_id` is still empty and fail/defer, never retrying within
 * budget. With ordering, both resolve within the same single pass because
 * `accounts` is attempted first and its captured id is visible to `cards`'
 * attempt later in the same loop.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { bootstrapCommand } from "../../src/cli/commands/bootstrap.ts";

describe("ARV-327: seed loop orders parents before children", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let apiDir: string;
  let specPath: string;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/accounts" && req.method === "GET") return Response.json([]);
        if (url.pathname === "/cards" && req.method === "GET") return Response.json([]);
        if (url.pathname === "/accounts" && req.method === "POST") {
          return Response.json({ id: "acct_1" }, { status: 201 });
        }
        if (url.pathname === "/cards" && req.method === "POST") {
          const body = (await req.json()) as { account_id?: string };
          if (body.account_id !== "acct_1") {
            return Response.json({ error: `account_id not found: ${body.account_id}` }, { status: 400 });
          }
          return Response.json({ id: "card_1" }, { status: 201 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    tmpDir = join(tmpdir(), `zond-bootstrap-arv327-${Date.now()}`);
    apiDir = join(tmpDir, "apis", "demo");
    await mkdir(apiDir, { recursive: true });
    specPath = join(apiDir, "spec.json");
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "demo", version: "1" },
        paths: {
          "/accounts": {
            get: { responses: { "200": { description: "ok" } } },
            post: {
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["name"],
                      properties: { name: { type: "string" } },
                    },
                  },
                },
              },
              responses: { "201": { description: "created" } },
            },
          },
          "/cards": {
            get: { responses: { "200": { description: "ok" } } },
            post: {
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["account_id"],
                      properties: { account_id: { type: "string" } },
                    },
                  },
                },
              },
              responses: { "201": { description: "created" } },
            },
          },
        },
      }),
    );

    // ARV-327: `cards` listed BEFORE `accounts` on purpose — insertion
    // order alone must not determine seed order.
    await writeFile(
      join(apiDir, ".api-resources.yaml"),
      [
        "resources:",
        "  - resource: cards",
        "    basePath: /cards",
        "    itemPath: /cards/{card_id}",
        "    idParam: card_id",
        "    captureField: id",
        "    hasFullCrud: false",
        "    endpoints:",
        "      list: GET /cards",
        "      create: POST /cards",
        "    fkDependencies:",
        "      - var: account_id",
        "        param: account_id",
        "        in: body",
        "        ownerResource: accounts",
        "  - resource: accounts",
        "    basePath: /accounts",
        "    itemPath: /accounts/{account_id}",
        "    idParam: account_id",
        "    captureField: id",
        "    hasFullCrud: false",
        "    endpoints:",
        "      list: GET /accounts",
        "      create: POST /accounts",
        "    fkDependencies: []",
        "",
      ].join("\n"),
    );
  });

  afterAll(async () => {
    server?.stop();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("both account_id and card_id seed successfully within a single outer pass", async () => {
    const envPath = join(apiDir, ".env.order.yaml");
    await writeFile(envPath, `base_url: ${baseUrl}\n`);

    const origWrite = process.stdout.write;
    const chunks: string[] = [];
    process.stdout.write = ((c: unknown) => {
      chunks.push(typeof c === "string" ? c : String(c));
      return true;
    }) as typeof process.stdout.write;
    let exit: number;
    try {
      exit = await bootstrapCommand({
        specPath,
        apiDir,
        envPath,
        apply: true,
        seed: true,
        json: true,
        maxPasses: 1,
      });
    } finally {
      process.stdout.write = origWrite;
    }

    const env = JSON.parse(chunks.join("")) as {
      data: {
        perTarget: Array<{ var: string; status: string; value?: string }>;
        summary: { seedsAttempted: number; seedsSucceeded: number };
      };
    };
    expect(exit).toBe(0);
    expect(env.data.summary.seedsSucceeded).toBe(2);
    const byVar = Object.fromEntries(env.data.perTarget.map((t) => [t.var, t]));
    expect(byVar.account_id?.status).toBe("seeded");
    expect(byVar.account_id?.value).toBe("acct_1");
    expect(byVar.card_id?.status).toBe("seeded");
    expect(byVar.card_id?.value).toBe("card_1");
  });
});

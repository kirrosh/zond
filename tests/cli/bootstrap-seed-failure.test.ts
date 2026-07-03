/**
 * ARV-275: when every seed POST fails, bootstrap should exit 2
 * (warning) and emit a Discovery-vs-Seed summary so the user sees the
 * failure instead of reading a misleading "Filled X/Y" line.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { bootstrapCommand } from "../../src/cli/commands/bootstrap.ts";

describe("ARV-275: prepare-fixtures seed-failure UX", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let apiDir: string;
  let specPath: string;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        // Empty list — forces seed path.
        if (url.pathname === "/widgets" && req.method === "GET") {
          return Response.json([]);
        }
        // Every seed POST fails with 422 (validation error).
        if (url.pathname === "/widgets" && req.method === "POST") {
          return Response.json({ error: "missing field" }, { status: 422 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    tmpDir = join(tmpdir(), `zond-bootstrap-arv275-${Date.now()}`);
    apiDir = join(tmpDir, "apis", "demo");
    await mkdir(apiDir, { recursive: true });
    specPath = join(apiDir, "spec.json");
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "demo", version: "1" },
        paths: {
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
                      properties: { name: { type: "string" } },
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

    await writeFile(
      join(apiDir, ".api-resources.yaml"),
      [
        "resources:",
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
      ].join("\n"),
    );
  });

  afterAll(async () => {
    server?.stop();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("0% seed success → exit 2 + warning", async () => {
    const envPath = join(apiDir, ".env.allfail.yaml");
    await writeFile(envPath, `base_url: ${baseUrl}\n`);

    const origLog = console.log;
    const origWarn = console.warn;
    const origConsoleErr = console.error;
    const origStdout = process.stdout.write;
    const origStderr = process.stderr.write;
    const lines: string[] = [];
    const sink = (...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(" "));
    };
    console.log = sink;
    console.warn = sink;
    console.error = sink;
    process.stdout.write = ((c: unknown) => { lines.push(typeof c === "string" ? c : String(c)); return true; }) as typeof process.stdout.write;
    process.stderr.write = ((c: unknown) => { lines.push(typeof c === "string" ? c : String(c)); return true; }) as typeof process.stderr.write;

    let exit: number;
    try {
      exit = await bootstrapCommand({
        specPath,
        apiDir,
        envPath,
        apply: true,
        seed: true,
        json: false,
      });
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origConsoleErr;
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    }

    expect(exit).toBe(2);
    const out = lines.join("\n");
    expect(out).toMatch(/Seed POST attempts:\s+\d+ total,\s+0 succeeded/);
    expect(out).toMatch(/0\/\d+ seed POSTs succeeded/i);
  });

  test("JSON envelope summary still surfaces seedsAttempted/seedsSucceeded", async () => {
    const envPath = join(apiDir, ".env.allfail.json.yaml");
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
      });
    } finally {
      process.stdout.write = origWrite;
    }
    expect(exit).toBe(2);
    const env = JSON.parse(chunks.join("")) as {
      data: { summary: { seedsAttempted: number; seedsSucceeded: number } };
    };
    expect(env.data.summary.seedsAttempted).toBeGreaterThan(0);
    expect(env.data.summary.seedsSucceeded).toBe(0);
  });
});

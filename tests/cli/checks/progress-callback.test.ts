/**
 * ARV-328: runChecks fires onProgress after every operation so the CLI can
 * print a throttled progress line during long coverage runs.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks } from "../../../src/core/checks/index.ts";

describe("runChecks onProgress (ARV-328)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;

  beforeAll(async () => {
    server = Bun.serve({ port: 0, fetch: () => Response.json({ ok: true }) });
    baseUrl = `http://localhost:${server.port}`;

    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 4; i++) {
      paths[`/items${i}`] = { get: { responses: { "200": { description: "ok" } } } };
    }
    tmpDir = join(tmpdir(), `zond-arv328-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0", info: { title: "d", version: "1" }, paths,
    }), "utf-8");
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("fires once per operation with cumulative counts", async () => {
    const calls: Array<{ done: number; total: number; cases: number }> = [];
    await runChecks({ specPath, baseUrl, onProgress: (p) => calls.push({ ...p }) });

    expect(calls).toHaveLength(4);
    expect(calls.every((c) => c.total === 4)).toBe(true);
    expect(calls.at(-1)!.done).toBe(4);
    // done is strictly increasing; cases monotonic non-decreasing.
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]!.done).toBe(calls[i - 1]!.done + 1);
      expect(calls[i]!.cases).toBeGreaterThanOrEqual(calls[i - 1]!.cases);
    }
    expect(calls.at(-1)!.cases).toBeGreaterThan(0);
  });
});

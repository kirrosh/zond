/**
 * ARV-342: deterministic operation-window (--skip-ops / --max-ops). Lets a
 * caller sweep a large spec in bounded, resumable slices that each finish
 * inside a short run budget (the fix for "587-op sweep SIGTERM-killed at
 * 15%"). This test asserts the slicing is exact and windows are disjoint +
 * cover the whole op set.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks } from "../../../src/core/checks/index.ts";

describe("checks run operation-window (ARV-342)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;
  const hits = new Set<string>();

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        hits.add(new URL(req.url).pathname);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    tmpDir = join(tmpdir(), `zond-op-window-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    const getOp = { responses: { "200": { description: "ok" } } };
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      paths: {
        "/a": { get: getOp },
        "/b": { get: getOp },
        "/c": { get: getOp },
        "/d": { get: getOp },
      },
    }), "utf-8");
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  // not_a_server_error applies to every op and needs no fixtures, so
  // summary.operations tracks the window size exactly. Built lazily so the
  // beforeAll-assigned specPath/baseUrl are captured, not their undefined
  // describe-time values.
  const opts = () => ({ specPath, baseUrl, include: ["not_a_server_error"] });

  test("no window → all operations", async () => {
    const r = await runChecks({ ...opts() });
    expect(r.data.summary.operations).toBe(4);
  });

  test("maxOps caps the window; skipOps resumes; windows are disjoint and cover all", async () => {
    hits.clear();
    const w0 = await runChecks({ ...opts(), skipOps: 0, maxOps: 2 });
    const w0Hits = new Set(hits);
    expect(w0.data.summary.operations).toBe(2);

    hits.clear();
    const w1 = await runChecks({ ...opts(), skipOps: 2, maxOps: 2 });
    const w1Hits = new Set(hits);
    expect(w1.data.summary.operations).toBe(2);

    // Disjoint windows, union == the whole 4-op spec.
    for (const p of w0Hits) expect(w1Hits.has(p)).toBe(false);
    expect(new Set([...w0Hits, ...w1Hits])).toEqual(new Set(["/a", "/b", "/c", "/d"]));
  });

  test("maxOps past the end → only the remaining ops (last-slice signal)", async () => {
    const last = await runChecks({ ...opts(), skipOps: 2, maxOps: 10 });
    // 2 remaining < maxOps 10 → this is how a caller detects the last slice.
    expect(last.data.summary.operations).toBe(2);
  });

  test("skipOps past the end → empty window", async () => {
    const none = await runChecks({ ...opts(), skipOps: 99, maxOps: 50 });
    expect(none.data.summary.operations).toBe(0);
  });
});

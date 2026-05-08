import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { createCollection, createRun, finalizeRun, saveResults } from "../../src/db/queries.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";
import { reportBundleCommand, parseBundleRange } from "../../src/cli/commands/report-bundle.ts";

const DB_PATH = join(tmpdir(), `zond-bundle-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

function makeRun(suiteName: string, failed: boolean): TestRunResult[] {
  return [{
    suite_name: suiteName,
    started_at: "2026-01-01T00:00:00.000Z",
    finished_at: "2026-01-01T00:00:01.000Z",
    total: 1,
    passed: failed ? 0 : 1,
    failed: failed ? 1 : 0,
    skipped: 0,
    steps: [{
      name: "step",
      status: failed ? "fail" : "pass",
      duration_ms: 10,
      request: { method: "GET", url: "http://localhost/x", headers: {} },
      response: { status: failed ? 500 : 200, headers: {}, body: "{}", duration_ms: 10 },
      assertions: [{ field: "status", rule: "equals 200", passed: !failed, actual: failed ? 500 : 200, expected: 200 }],
      captures: {},
      ...(failed ? { failure_class: "definitely_bug" as const, failure_class_reason: "5xx" } : {}),
    }],
  }];
}

let runIds: number[] = [];

beforeAll(() => {
  getDb(DB_PATH);
  const colId = createCollection({ name: "T", test_path: "./tests" });
  for (let i = 0; i < 3; i++) {
    const r = makeRun(`suite ${i}`, i !== 0); // run 0 passes, 1+2 fail
    const id = createRun({ started_at: "2026-01-01T00:00:00.000Z", environment: "test", collection_id: colId });
    finalizeRun(id, r);
    saveResults(id, r);
    runIds.push(id);
  }
});

afterAll(() => {
  closeDb();
  try { rmSync(DB_PATH, { force: true }); } catch {}
});

describe("parseBundleRange", () => {
  it("parses A..B inclusive", () => {
    expect(parseBundleRange("3..5")).toEqual([3, 4, 5]);
  });
  it("parses comma list and dedupes", () => {
    expect(parseBundleRange("7,3,3,5")).toEqual([3, 5, 7]);
  });
  it("parses single id", () => {
    expect(parseBundleRange("42")).toEqual([42]);
  });
  it("rejects start > end", () => {
    const r = parseBundleRange("9..3");
    expect(typeof r === "object" && !Array.isArray(r) ? r.error : "").toMatch(/greater/);
  });
  it("rejects empty input", () => {
    const r = parseBundleRange("");
    expect(typeof r === "object" && !Array.isArray(r) ? r.error : "").toBeTruthy();
  });
});

describe("report bundle", () => {
  it("writes case-study + html + diagnose for each run with failures, plus index.md", async () => {
    const out = mkdtempSync(join(tmpdir(), "bundle-out-"));
    try {
      const code = await reportBundleCommand({
        range: `${runIds[0]}..${runIds[2]}`,
        output: out,
        dbPath: DB_PATH,
      });
      expect(code).toBe(0);
      expect(existsSync(join(out, "index.md"))).toBe(true);

      const idx = readFileSync(join(out, "index.md"), "utf-8");
      expect(idx).toContain("# Bundle index");
      for (const id of runIds) expect(idx).toContain(`| ${id} |`);

      // Run 0 passed → no case-study; runs 1+2 failed → case-study present.
      expect(existsSync(join(out, String(runIds[0]), "case-study.md"))).toBe(false);
      expect(existsSync(join(out, String(runIds[1]), "case-study.md"))).toBe(true);
      expect(existsSync(join(out, String(runIds[2]), "case-study.md"))).toBe(true);

      // HTML + diagnose written for all runs.
      for (const id of runIds) {
        expect(existsSync(join(out, String(id), "report.html"))).toBe(true);
        expect(existsSync(join(out, String(id), "diagnose.json"))).toBe(true);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("--include filter restricts artefacts", async () => {
    const out = mkdtempSync(join(tmpdir(), "bundle-inc-"));
    try {
      const code = await reportBundleCommand({
        range: `${runIds[1]}`,
        output: out,
        include: ["diagnose"],
        dbPath: DB_PATH,
      });
      expect(code).toBe(0);
      const runDir = join(out, String(runIds[1]));
      expect(existsSync(join(runDir, "diagnose.json"))).toBe(true);
      expect(existsSync(join(runDir, "report.html"))).toBe(false);
      expect(existsSync(join(runDir, "case-study.md"))).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("returns 2 on invalid range", async () => {
    const code = await reportBundleCommand({ range: "not-a-range", output: "/tmp/x", dbPath: DB_PATH });
    expect(code).toBe(2);
  });

  it("returns 1 when no runs resolve in the range", async () => {
    const out = mkdtempSync(join(tmpdir(), "bundle-empty-"));
    try {
      const code = await reportBundleCommand({ range: "99000..99002", output: out, dbPath: DB_PATH });
      expect(code).toBe(1);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

import { describe, test, expect, mock, afterEach, beforeEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { runCommand } from "../../src/cli/commands/run.ts";
import { closeDb } from "../../src/db/schema.ts";

const originalFetch = globalThis.fetch;
const originalCwd = process.cwd();

function mockFetchOk() {
  globalThis.fetch = mock(async (input: Request | string | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new Response(JSON.stringify({ ok: true, url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function suppressOutput() {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  process.stdout.write = mock((chunk: unknown) => {
    outChunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = mock((chunk: unknown) => {
    errChunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    restore: () => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    },
    outChunks,
    errChunks,
  };
}

describe("zond run --report-out (TASK-LOW.1)", () => {
  let workDir: string;
  let testFile: string;
  let suppress: ReturnType<typeof suppressOutput>;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "zond-report-out-"));
    testFile = join(workDir, "api.yaml");
    writeFileSync(
      testFile,
      [
        "name: Report Out",
        "base_url: https://api.example.test",
        "tests:",
        "  - name: \"alive\"",
        "    GET: /ping",
        "    expect:",
        "      status: 200",
        "",
      ].join("\n"),
      "utf-8",
    );
    process.chdir(workDir);
    suppress = suppressOutput();
    mockFetchOk();
  });

  afterEach(() => {
    suppress.restore();
    globalThis.fetch = originalFetch;
    closeDb();
    process.chdir(originalCwd);
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test("writes JSON report to a file and emits no JSON on stdout", async () => {
    const outPath = join(workDir, "out", "results.json");
    const code = await runCommand({
      path: testFile,
      report: "json",
      bail: false,
      noDb: true,
      reportOut: outPath,
    });

    expect(code).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const fileContent = readFileSync(outPath, "utf-8");
    // Must parse as JSON cleanly — no banner, no help text
    const parsed = JSON.parse(fileContent);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].suite_name).toBe("Report Out");
    // stdout must contain no report content
    const stdoutText = suppress.outChunks.join("");
    expect(stdoutText).not.toContain("\"suite_name\"");
    // stderr should mention the file
    const stderrText = suppress.errChunks.join("");
    expect(stderrText).toContain("report written to");
    expect(stderrText).toContain(outPath);
  });

  test("writes JUnit XML report when --report junit is selected", async () => {
    const outPath = join(workDir, "junit.xml");
    const code = await runCommand({
      path: testFile,
      report: "junit",
      bail: false,
      noDb: true,
      reportOut: outPath,
    });

    expect(code).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const fileContent = readFileSync(outPath, "utf-8");
    expect(fileContent.startsWith("<?xml")).toBe(true);
    expect(fileContent).toContain("<testsuites");
  });

  test("creates parent directories as needed", async () => {
    const outPath = join(workDir, "deep", "nested", "out", "results.json");
    const code = await runCommand({
      path: testFile,
      report: "json",
      bail: false,
      noDb: true,
      reportOut: outPath,
    });
    expect(code).toBe(0);
    expect(existsSync(outPath)).toBe(true);
  });
});

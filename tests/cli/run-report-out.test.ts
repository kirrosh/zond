import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { join } from "path";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { runCommand } from "../../src/cli/commands/run.ts";
import { closeDb } from "../../src/db/schema.ts";
import { captureOutput } from "../_helpers/output";
import { mockFetchOk, restoreFetch } from "../_helpers/fetch-mock";
import { makeWorkspace } from "../_helpers/workspace";

describe("zond run --output (TASK-LOW.1 / ARV-117 — migrated from --report-out)", () => {
  let workDir: string;
  let cleanupWs: () => void;
  let testFile: string;
  let suppress: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    const ws = makeWorkspace({ prefix: "zond-report-out-", chdir: true });
    workDir = ws.path;
    cleanupWs = ws.cleanup;
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
    suppress = captureOutput();
    mockFetchOk();
  });

  afterEach(() => {
    suppress.restore();
    restoreFetch();
    closeDb();
    cleanupWs();
  });

  test("writes JSON report to a file and emits no JSON on stdout", async () => {
    const outPath = join(workDir, "out", "results.json");
    const code = await runCommand({
      paths: [testFile],
      report: "json",
      bail: false,
      noDb: true,
      output: outPath,
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
      paths: [testFile],
      report: "junit",
      bail: false,
      noDb: true,
      output: outPath,
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
      paths: [testFile],
      report: "json",
      bail: false,
      noDb: true,
      output: outPath,
    });
    expect(code).toBe(0);
    expect(existsSync(outPath)).toBe(true);
  });
});

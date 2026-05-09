import { describe, test, expect, afterEach, beforeEach, mock } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { runCommand } from "../../src/cli/commands/run.ts";
import { closeDb } from "../../src/db/schema.ts";
import { captureOutput } from "../_helpers/output";
import { mockFetchOk, restoreFetch } from "../_helpers/fetch-mock";
import { makeWorkspace } from "../_helpers/workspace";

describe("zond run — cwd .env.yaml fallback (TASK-HIGH.3)", () => {
  const originalCwd = process.cwd();
  let workDir: string;
  let testFile: string;
  let cwdDir: string;
  let cleanupWs: () => void;
  let suppress: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    // Layout:
    //   <work>/tests/api.yaml      (uses {{base_url}})
    //   <cwd>/.env.yaml            (provides base_url)
    // Run with cwd = <cwd>, path = absolute /…/tests/api.yaml — neither
    // searchDir nor its parent contains an env file, so the cwd fallback
    // must kick in.
    const ws = makeWorkspace({ prefix: "zond-cwd-env-" });
    cleanupWs = ws.cleanup;
    workDir = join(ws.path, "suites", "tests");
    cwdDir = join(ws.path, "collection");
    mkdirSync(workDir, { recursive: true });
    mkdirSync(cwdDir, { recursive: true });

    testFile = join(workDir, "api.yaml");
    writeFileSync(
      testFile,
      [
        "name: Cwd Env Fallback",
        "base_url: \"{{base_url}}\"",
        "tests:",
        "  - name: \"alive\"",
        "    GET: /ping",
        "    expect:",
        "      status: 200",
        "",
      ].join("\n"),
      "utf-8",
    );

    writeFileSync(
      join(cwdDir, ".env.yaml"),
      "base_url: https://api.cwd.example\n",
      "utf-8",
    );

    process.chdir(cwdDir);
    suppress = captureOutput();
    mockFetchOk();
  });

  afterEach(() => {
    suppress.restore();
    restoreFetch();
    closeDb();
    process.chdir(originalCwd);
    cleanupWs();
  });

  test("loads ./.env.yaml from cwd when --env not given and searchDir has none", async () => {
    const code = await runCommand({
      paths: [testFile],
      env: undefined,
      report: "json",
      bail: false,
      noDb: true,
    });

    expect(code).toBe(0);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    expect(fetchMock.mock.calls.length).toBe(1);
    const firstCall = fetchMock.mock.calls[0]!;
    const reqArg = firstCall[0] as Request | string | URL;
    const url = typeof reqArg === "string" ? reqArg : reqArg instanceof URL ? reqArg.href : reqArg.url;
    expect(url).toContain("https://api.cwd.example/ping");

    // Notice should be on stderr
    const stderrText = suppress.errChunks.join("");
    expect(stderrText).toContain("./.env.yaml");
  });

  test("does NOT print fallback notice when cwd already covered by searchDir", async () => {
    // Move .env.yaml to alongside the test file's parent — the regular loader
    // covers it, so the fallback branch should not engage.
    rmSync(join(cwdDir, ".env.yaml"));
    writeFileSync(
      join(workDir, "..", ".env.yaml"),
      "base_url: https://api.local.example\n",
      "utf-8",
    );

    const code = await runCommand({
      paths: [testFile],
      env: undefined,
      report: "json",
      bail: false,
      noDb: true,
    });

    expect(code).toBe(0);
    const stderrText = suppress.errChunks.join("");
    expect(stderrText).not.toContain("cwd fallback");
  });
});

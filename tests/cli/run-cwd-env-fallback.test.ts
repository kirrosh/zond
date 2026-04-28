import { describe, test, expect, mock, afterEach, beforeEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
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
  const errChunks: string[] = [];
  process.stdout.write = mock(() => true) as typeof process.stdout.write;
  process.stderr.write = mock((chunk: unknown) => {
    errChunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    restore: () => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    },
    errChunks,
  };
}

describe("zond run — cwd .env.yaml fallback (TASK-HIGH.3)", () => {
  let workDir: string;
  let testFile: string;
  let cwdDir: string;
  let suppress: ReturnType<typeof suppressOutput>;

  beforeEach(() => {
    // Layout:
    //   <work>/tests/api.yaml      (uses {{base_url}})
    //   <cwd>/.env.yaml            (provides base_url)
    // Run with cwd = <cwd>, path = absolute /…/tests/api.yaml — neither
    // searchDir nor its parent contains an env file, so the cwd fallback
    // must kick in.
    const root = mkdtempSync(join(tmpdir(), "zond-cwd-env-"));
    workDir = join(root, "suites", "tests");
    cwdDir = join(root, "collection");
    require("fs").mkdirSync(workDir, { recursive: true });
    require("fs").mkdirSync(cwdDir, { recursive: true });

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
    suppress = suppressOutput();
    mockFetchOk();
  });

  afterEach(() => {
    suppress.restore();
    globalThis.fetch = originalFetch;
    closeDb();
    process.chdir(originalCwd);
    try {
      rmSync(workDir, { recursive: true, force: true });
      rmSync(cwdDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  test("loads ./.env.yaml from cwd when --env not given and searchDir has none", async () => {
    const code = await runCommand({
      path: testFile,
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
      path: testFile,
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

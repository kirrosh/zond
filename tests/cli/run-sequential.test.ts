import { describe, test, expect, mock, afterEach, beforeEach } from "bun:test";
import { join } from "path";
import { writeFileSync } from "fs";
import { runCommand } from "../../src/cli/commands/run.ts";
import { closeDb } from "../../src/db/schema.ts";
import { captureOutput } from "../_helpers/output";
import { restoreFetch } from "../_helpers/fetch-mock";
import { makeWorkspace } from "../_helpers/workspace";

describe("zond run --sequential (TASK-39)", () => {
  let workDir: string;
  let cleanupWs: () => void;
  let suppress: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    const ws = makeWorkspace({ prefix: "zond-seq-", chdir: true });
    workDir = ws.path;
    cleanupWs = ws.cleanup;
    suppress = captureOutput();
  });

  afterEach(() => {
    suppress.restore();
    restoreFetch();
    closeDb();
    cleanupWs();
  });

  test("runs regular suites one at a time when --sequential is set", async () => {
    // Two separate suite files → two regular suites.
    for (const n of [1, 2]) {
      writeFileSync(
        join(workDir, `suite-${n}.yaml`),
        [
          `name: Suite ${n}`,
          "base_url: https://api.example.test",
          "tests:",
          `  - name: "ping ${n}"`,
          `    GET: /ping/${n}`,
          "    expect:",
          "      status: 200",
          "",
        ].join("\n"),
        "utf-8",
      );
    }

    // Track concurrency: max number of in-flight requests at any time.
    let inFlight = 0;
    let maxInFlight = 0;
    globalThis.fetch = mock(async () => {
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      // Tiny delay to give parallel runs a chance to overlap.
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const code = await runCommand({
      paths: [workDir],
      report: "json",
      bail: false,
      sequential: true,
      noDb: true,
    });
    expect(code).toBe(0);
    // With --sequential, only one suite (and thus only one fetch) at a time.
    expect(maxInFlight).toBe(1);
  });
});

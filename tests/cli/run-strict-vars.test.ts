import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { runCommand } from "../../src/cli/commands/run.ts";
import { closeDb } from "../../src/db/schema.ts";

function suppress() {
  const oOut = process.stdout.write;
  const oErr = process.stderr.write;
  const errs: string[] = [];
  process.stdout.write = mock(() => true) as typeof process.stdout.write;
  process.stderr.write = mock((c: unknown) => {
    errs.push(typeof c === "string" ? c : String(c));
    return true;
  }) as typeof process.stderr.write;
  return {
    restore: () => {
      process.stdout.write = oOut;
      process.stderr.write = oErr;
    },
    errs,
  };
}

describe("TASK-75: pre-flight var check + --strict-vars", () => {
  let dir: string;
  let s: ReturnType<typeof suppress>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "zond-task75-"));
    s = suppress();
    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ id: 42 }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  });

  afterEach(() => {
    s.restore();
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
    closeDb();
  });

  test("warns about missing var by default, exit 0 when tests pass", async () => {
    writeFileSync(
      join(dir, "t.yaml"),
      "name: T\nbase_url: http://localhost\ntests:\n  - name: r\n    GET: /x?email={{nonexistent_var}}\n    expect: {}\n",
    );
    const code = await runCommand({ paths: [dir], report: "json", bail: false, noDb: true });
    expect(code).toBe(0);
    expect(s.errs.join("")).toMatch(/Undefined variable \{\{nonexistent_var\}\}/);
  });

  test("--strict-vars hard-fails with exit 2", async () => {
    writeFileSync(
      join(dir, "t.yaml"),
      "name: T\nbase_url: http://localhost\ntests:\n  - name: r\n    GET: /x?email={{nonexistent_var}}\n    expect: {}\n",
    );
    const code = await runCommand({ paths: [dir], report: "json", bail: false, noDb: true, strictVars: true });
    expect(code).toBe(2);
    expect(s.errs.join("")).toMatch(/strict-vars/);
  });

  test("ARV-414: --strict-vars abort still writes the --output artifact", async () => {
    writeFileSync(
      join(dir, "t.yaml"),
      "name: T\nbase_url: http://localhost\ntests:\n  - name: r\n    GET: /x?email={{nonexistent_var}}\n    expect: {}\n",
    );
    const outPath = join(dir, "report.json");
    const code = await runCommand({ paths: [dir], report: "json", output: outPath, bail: false, noDb: true, strictVars: true });
    expect(code).toBe(2);
    // Pre-fix the run returned 2 before writing anything, so a pipeline saw a
    // missing file. Now the artifact exists (empty-results envelope for the
    // setup-scope abort) so downstream stages parse "aborted" instead.
    const { readFileSync, existsSync } = await import("node:fs");
    expect(existsSync(outPath)).toBe(true);
    expect(() => JSON.parse(readFileSync(outPath, "utf-8"))).not.toThrow();
  });

  test("captures from prior steps suppress false-positive warnings", async () => {
    writeFileSync(
      join(dir, "t.yaml"),
      "name: T\nbase_url: http://localhost\ntests:\n  - name: create\n    POST: /u\n    expect:\n      body:\n        id: { capture: user_id }\n  - name: get\n    GET: /u/{{user_id}}\n    expect: {}\n",
    );
    const code = await runCommand({ paths: [dir], report: "json", bail: false, noDb: true, strictVars: true });
    expect(code).toBe(0);
    expect(s.errs.join("")).not.toMatch(/Undefined variable/);
  });

  // ARV-105 (F10): a regression suite that depends on a capture-chain var
  // with no producer (e.g. probe-emitted suite for {{monitor_id_or_slug}})
  // skips every step at runtime and exits with passed=0/failed=0/skipped=N.
  // Pre-fix the JSON envelope reported "0 failed" with no signal that
  // nothing was actually exercised — green CI hid the visibility-pitfall.
  // Now run surfaces all-skipped suites in a dedicated key + stderr line.
  test("ARV-105: all-skipped suites surface in JSON envelope and stderr", async () => {
    // Suite uses skip_if to mark every step as conditionally skipped when
    // {{monitor_id_or_slug}} is unbound — emulates probe-emitted regression
    // suites for capture-chain ids that prepare-fixtures can't fill.
    writeFileSync(
      join(dir, "skipper.yaml"),
      [
        "name: probe PUT /monitors/{monitor_id_or_slug}/",
        "base_url: http://localhost",
        "tests:",
        "  - name: attack-1",
        "    PUT: /monitors/{{monitor_id_or_slug}}/",
        "    skip_if: \"{{monitor_id_or_slug}} == ''\"",
        "    expect: {}",
        "  - name: attack-2",
        "    PUT: /monitors/{{monitor_id_or_slug}}/",
        "    skip_if: \"{{monitor_id_or_slug}} == ''\"",
        "    expect: {}",
        "",
      ].join("\n"),
    );

    // Capture stdout to read the JSON envelope.
    const oOut = process.stdout.write;
    const out: string[] = [];
    process.stdout.write = mock((c: unknown) => { out.push(typeof c === "string" ? c : String(c)); return true; }) as typeof process.stdout.write;
    let code: number;
    try {
      code = await runCommand({ paths: [dir], report: "json", bail: false, noDb: true, json: true });
    } finally {
      process.stdout.write = oOut;
    }
    expect(code).toBe(0); // skip-only is not a failure

    const envelope = JSON.parse(out.join("")) as {
      data: {
        summary: { total: number; passed: number; failed: number; allSkippedSuites?: number };
        all_skipped_suites?: Array<{ suite: string; total: number }>;
      };
    };
    expect(envelope.data.summary.allSkippedSuites).toBe(1);
    expect(envelope.data.all_skipped_suites).toHaveLength(1);
    expect(envelope.data.all_skipped_suites![0]!.suite).toMatch(/monitors/);
  });
});

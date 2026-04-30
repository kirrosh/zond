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
    const code = await runCommand({ path: dir, report: "json", bail: false, noDb: true });
    expect(code).toBe(0);
    expect(s.errs.join("")).toMatch(/Undefined variable \{\{nonexistent_var\}\}/);
  });

  test("--strict-vars hard-fails with exit 2", async () => {
    writeFileSync(
      join(dir, "t.yaml"),
      "name: T\nbase_url: http://localhost\ntests:\n  - name: r\n    GET: /x?email={{nonexistent_var}}\n    expect: {}\n",
    );
    const code = await runCommand({ path: dir, report: "json", bail: false, noDb: true, strictVars: true });
    expect(code).toBe(2);
    expect(s.errs.join("")).toMatch(/strict-vars/);
  });

  test("captures from prior steps suppress false-positive warnings", async () => {
    writeFileSync(
      join(dir, "t.yaml"),
      "name: T\nbase_url: http://localhost\ntests:\n  - name: create\n    POST: /u\n    expect:\n      body:\n        id: { capture: user_id }\n  - name: get\n    GET: /u/{{user_id}}\n    expect: {}\n",
    );
    const code = await runCommand({ path: dir, report: "json", bail: false, noDb: true, strictVars: true });
    expect(code).toBe(0);
    expect(s.errs.join("")).not.toMatch(/Undefined variable/);
  });
});

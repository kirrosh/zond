/**
 * Regression: `zond run ""` (empty path argument) used to bypass the
 * `paths.length === 0` guard (`[""].length === 1`) and recursed through
 * `parseSafe("")` → `parseDirectorySafe("")`, where Bun.Glob with an
 * empty `cwd` walks the workspace and produces phantom absolute paths
 * like `/apis/<name>/probes/...` that all fail to read. The user-facing
 * output was a confusing `Error: All 167 test file(s) in  failed to
 * parse` (note the blank path slot).
 *
 * Empty/whitespace-only path arguments must be rejected upfront with
 * exit code 2 and a clear message.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../../src/cli/commands/run.ts";
import { closeDb } from "../../src/db/schema.ts";
import { captureOutput } from "../_helpers/output";

describe("zond run: empty path argument is a hard error", () => {
  let suppress: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    suppress = captureOutput();
  });

  afterEach(() => {
    suppress.restore();
    closeDb();
  });

  test('zond run "" exits 2 with explicit "Empty path argument" message', async () => {
    const code = await runCommand({
      paths: [""],
      report: "console",
      bail: false,
      noDb: true,
    });

    expect(code).toBe(2);
    const stderr = suppress.errChunks.join("");
    expect(stderr).toContain("Empty path argument");
    expect(stderr).not.toContain("failed to parse");
  });

  test("whitespace-only path exits 2 (no globbing fallback)", async () => {
    const code = await runCommand({
      paths: ["   "],
      report: "console",
      bail: false,
      noDb: true,
    });

    expect(code).toBe(2);
    const stderr = suppress.errChunks.join("");
    expect(stderr).toContain("Empty path argument");
  });

  test("mixed valid + empty rejects the whole call (count surfaced)", async () => {
    const code = await runCommand({
      paths: ["tests/foo.yaml", "", ""],
      report: "console",
      bail: false,
      noDb: true,
    });

    expect(code).toBe(2);
    const stderr = suppress.errChunks.join("");
    expect(stderr).toContain("Empty path argument");
    expect(stderr).toContain("2 blank entries");
  });
});

// ARV-357: empty dir + --output used to exit 0 and write NO file, so a
// scripted pipeline saw a missing file with no error to key on. It must
// now still write an empty "0 tests" envelope.
describe("zond run: empty dir still writes --output envelope", () => {
  let suppress: ReturnType<typeof captureOutput>;
  let dir: string;

  beforeEach(() => {
    suppress = captureOutput();
    dir = mkdtempSync(join(tmpdir(), "zond-empty-"));
  });

  afterEach(() => {
    suppress.restore();
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  test("empty dir + --report json + --output writes [] and exits 0", async () => {
    const out = join(dir, "report.json");
    const code = await runCommand({
      paths: [dir],
      report: "json",
      output: out,
      bail: false,
      noDb: true,
    });

    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(JSON.parse(readFileSync(out, "utf-8"))).toEqual([]);
  });
});

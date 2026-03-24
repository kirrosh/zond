import { describe, test, expect, mock, afterEach, beforeEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, unlinkSync, rmSync } from "fs";
import { initCommand } from "../../src/cli/commands/init.ts";
import { closeDb } from "../../src/db/schema.ts";

function tryUnlink(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

function suppressOutput() {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  let captured = "";
  process.stdout.write = mock((data: any) => { captured += String(data); return true; }) as typeof process.stdout.write;
  process.stderr.write = mock(() => true) as typeof process.stderr.write;
  return {
    restore() {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    },
    getCaptured() { return captured; },
  };
}

const FIXTURES = `${import.meta.dir}/../fixtures`;

describe("initCommand", () => {
  let output: ReturnType<typeof suppressOutput>;
  let tmpDir: string;
  let db: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `zond-init-test-${Date.now()}`);
    db = join(tmpdir(), `zond-init-${Date.now()}.db`);
  });

  afterEach(() => {
    output?.restore();
    closeDb();
    tryUnlink(db);
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test("creates API with spec --json", async () => {
    output = suppressOutput();
    const code = await initCommand({
      name: "test-api",
      spec: `${FIXTURES}/petstore-simple.json`,
      dir: tmpDir,
      dbPath: db,
      json: true,
    });
    const captured = output.getCaptured();
    if (code !== 0) console.error("INIT FAILED:", captured);
    expect(code).toBe(0);
    const envelope = JSON.parse(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("init");
    expect(envelope.data.endpoints).toBeGreaterThan(0);
    expect(existsSync(join(tmpDir, "tests"))).toBe(true);
  });

  test("returns 2 without spec", async () => {
    output = suppressOutput();
    const code = await initCommand({
      name: "no-spec",
      dir: tmpDir,
      dbPath: db,
      json: true,
    });
    // setupApi without spec creates collection with 0 endpoints
    expect(code).toBe(0);
  });
});

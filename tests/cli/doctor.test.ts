import { describe, test, expect, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import { closeDb } from "../../src/db/schema.ts";
import { doctorCommand } from "../../src/cli/commands/doctor.ts";

function tmpDb(): string {
  return join(tmpdir(), `zond-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function tryUnlink(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe("doctorCommand", () => {
  let dbPath: string;

  afterEach(() => {
    closeDb();
    if (dbPath) tryUnlink(dbPath);
  });

  test("runs with valid db path and returns 0 or 1", async () => {
    dbPath = tmpDb();
    const code = await doctorCommand({ dbPath });
    // Should succeed (0) or have non-fatal warnings (1) — never crash
    expect(code === 0 || code === 1).toBe(true);
  });

  test("handles invalid db path gracefully", async () => {
    dbPath = "/nonexistent/path/to/db.sqlite";
    const code = await doctorCommand({ dbPath });
    // Database check will fail, so code should be 1
    expect(code).toBe(1);
  });
});

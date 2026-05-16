import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { initCommand } from "../../src/cli/commands/init/index.ts";
import { closeDb } from "../../src/db/schema.ts";
import { captureOutput } from "../_helpers/output";
import { tmpDb, unlinkDb as tryUnlink } from "../_helpers/tmp-db";

const FIXTURES = `${import.meta.dir}/../fixtures`;

describe("initCommand", () => {
  let output: ReturnType<typeof captureOutput>;
  let tmpDir: string;
  let db: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `zond-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    db = tmpDb("zond-init");
  });

  afterEach(() => {
    output?.restore();
    closeDb();
    tryUnlink(db);
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test("creates API with spec --json", async () => {
    output = captureOutput();
    const code = await initCommand({
      name: "test-api",
      spec: `${FIXTURES}/petstore-simple.json`,
      dir: tmpDir,
      dbPath: db,
      json: true,
    });
    const captured = output.out;
    if (code !== 0) console.error("INIT FAILED:", captured);
    expect(code).toBe(0);
    const envelope = JSON.parse(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("init");
    expect(envelope.data.endpoints).toBeGreaterThan(0);
    expect(existsSync(join(tmpDir, "tests"))).toBe(true);
  });

  test("without spec runs workspace bootstrap (mode=workspace)", async () => {
    output = captureOutput();
    const wsCwd = mkdtempSync(join(tmpdir(), "zond-init-ws-"));
    const wsHome = mkdtempSync(join(tmpdir(), "zond-init-home-"));
    try {
      const code = await initCommand({
        cwd: wsCwd,
        home: wsHome,
        noAgents: true,
        json: true,
      });
      expect(code).toBe(0);
      const envelope = JSON.parse(output.out);
      expect(envelope.ok).toBe(true);
      expect(envelope.data.mode).toBe("workspace");
      expect(envelope.data.configAction).toBe("created");
      expect(envelope.data.apisAction).toBe("created");
      expect(envelope.data.agentsPath).toBeNull();
      expect(existsSync(join(wsCwd, "zond.config.yml"))).toBe(true);
      expect(existsSync(join(wsCwd, "apis"))).toBe(true);
    } finally {
      rmSync(wsCwd, { recursive: true, force: true });
      rmSync(wsHome, { recursive: true, force: true });
    }
  });

  test("--with-spec runs bootstrap+register in one call", async () => {
    output = captureOutput();
    const wsCwd = mkdtempSync(join(tmpdir(), "zond-init-combo-"));
    const wsHome = mkdtempSync(join(tmpdir(), "zond-init-home-"));
    try {
      const code = await initCommand({
        cwd: wsCwd,
        home: wsHome,
        noAgents: true,
        withSpec: `${FIXTURES}/petstore-simple.json`,
        name: "petstore",
        dir: join(wsCwd, "apis", "petstore"),
        dbPath: db,
        json: true,
      });
      expect(code).toBe(0);
      const envelope = JSON.parse(output.out);
      expect(envelope.data.mode).toBe("bootstrap+register");
      expect(envelope.data.endpoints).toBeGreaterThan(0);
      expect(existsSync(join(wsCwd, "zond.config.yml"))).toBe(true);
      expect(existsSync(join(wsCwd, "apis", "petstore", "tests"))).toBe(true);
    } finally {
      rmSync(wsCwd, { recursive: true, force: true });
      rmSync(wsHome, { recursive: true, force: true });
    }
  });

  test("rejects --spec combined with --workspace", async () => {
    output = captureOutput();
    const code = await initCommand({
      spec: `${FIXTURES}/petstore-simple.json`,
      workspace: true,
      json: true,
    });
    expect(code).toBe(2);
    const envelope = JSON.parse(output.out);
    expect(envelope.ok).toBe(false);
  });
});

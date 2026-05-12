/**
 * In-process tests for `zond remove api`.
 *
 * Spawns no child processes — calls `removeApiCommand` directly with a
 * captured stdout/stderr, mirroring tests/cli/doctor.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupApi } from "../../src/core/setup-api.ts";
import { closeDb, getDb } from "../../src/db/schema.ts";
import { removeApiCommand } from "../../src/cli/commands/remove-api.ts";
import { writeCurrentApi, currentApiPath } from "../../src/core/context/current.ts";
import { captureOutput } from "../_helpers/output";

const MICROSPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "tiny", version: "1.0" },
  servers: [{ url: "https://example.com" }],
  paths: {
    "/ping": {
      get: { responses: { "200": {} } },
    },
  },
});

describe("zond remove api", () => {
  let workspace: string;
  let savedCwd: string;
  let dbPath: string;

  beforeEach(async () => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-remove-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n", "utf-8");
    const specPath = join(workspace, "tiny-spec.json");
    writeFileSync(specPath, MICROSPEC, "utf-8");
    dbPath = join(workspace, "zond.db");
    savedCwd = process.cwd();
    process.chdir(workspace);
    await setupApi({ name: "tiny", spec: specPath, dbPath });
    closeDb();
  });

  afterEach(() => {
    closeDb();
    process.chdir(savedCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  test("removes DB row, deletes apis/<name>/, returns json envelope", async () => {
    const apiDir = join(workspace, "apis", "tiny");
    expect(existsSync(apiDir)).toBe(true);

    const cap = captureOutput();
    const exit = await removeApiCommand({ api: "tiny", yes: true, json: true, dbPath });
    cap.restore();

    expect(exit).toBe(0);
    expect(existsSync(apiDir)).toBe(false);

    const env = JSON.parse(cap.out.trim());
    expect(env.ok).toBe(true);
    expect(env.command).toBe("remove-api");
    expect(env.data.api).toBe("tiny");
    expect(env.data.removedDir).toBe("apis/tiny");
    expect(env.data.detachedRuns).toBe(0);
    expect(env.data.deletedRuns).toBe(0);

    closeDb();
    getDb(dbPath);
    const row = getDb().query("SELECT id FROM collections WHERE name = ?").get("tiny");
    expect(row).toBeNull();
  });

  test("returns 2 on unknown API", async () => {
    const cap = captureOutput();
    const exit = await removeApiCommand({ api: "ghost", yes: true, json: true, dbPath });
    cap.restore();

    expect(exit).toBe(2);
    const env = JSON.parse(cap.out.trim());
    expect(env.ok).toBe(false);
    expect(env.errors[0].message).toContain("not found");
  });

  test("--keep-files leaves the directory on disk", async () => {
    const apiDir = join(workspace, "apis", "tiny");
    const cap = captureOutput();
    const exit = await removeApiCommand({ api: "tiny", yes: true, keepFiles: true, json: true, dbPath });
    cap.restore();

    expect(exit).toBe(0);
    expect(existsSync(apiDir)).toBe(true);

    const env = JSON.parse(cap.out.trim());
    expect(env.data.removedDir).toBeNull();
  });

  test("--purge deletes runs+results, default detaches", async () => {
    closeDb();
    const db = getDb(dbPath);
    const collectionId = (db.query("SELECT id FROM collections WHERE name = ?").get("tiny") as { id: number }).id;

    db.prepare(
      "INSERT INTO runs (id, started_at, environment, collection_id) VALUES (?, ?, ?, ?)",
    ).run(101, new Date().toISOString(), "test", collectionId);
    db.prepare(
      "INSERT INTO runs (id, started_at, environment, collection_id) VALUES (?, ?, ?, ?)",
    ).run(102, new Date().toISOString(), "test", collectionId);
    closeDb();

    const cap = captureOutput();
    const exit = await removeApiCommand({ api: "tiny", yes: true, purge: true, json: true, dbPath });
    cap.restore();

    expect(exit).toBe(0);
    const env = JSON.parse(cap.out.trim());
    expect(env.data.deletedRuns).toBe(2);
    expect(env.data.detachedRuns).toBe(0);

    closeDb();
    const left = (getDb(dbPath)
      .query("SELECT COUNT(*) AS c FROM runs WHERE id IN (101, 102)")
      .get() as { c: number }).c;
    expect(left).toBe(0);
  });

  test("default detach keeps runs with collection_id=NULL", async () => {
    closeDb();
    const db = getDb(dbPath);
    const collectionId = (db.query("SELECT id FROM collections WHERE name = ?").get("tiny") as { id: number }).id;
    db.prepare(
      "INSERT INTO runs (id, started_at, environment, collection_id) VALUES (?, ?, ?, ?)",
    ).run(201, new Date().toISOString(), "test", collectionId);
    closeDb();

    const cap = captureOutput();
    const exit = await removeApiCommand({ api: "tiny", yes: true, json: true, dbPath });
    cap.restore();

    expect(exit).toBe(0);
    const env = JSON.parse(cap.out.trim());
    expect(env.data.detachedRuns).toBe(1);

    closeDb();
    const row = getDb(dbPath)
      .query("SELECT collection_id FROM runs WHERE id = 201")
      .get() as { collection_id: number | null };
    expect(row.collection_id).toBeNull();
  });

  test("clears .zond/current-api when removed API was active", async () => {
    writeCurrentApi("tiny", workspace);
    const markerPath = currentApiPath(workspace);
    expect(existsSync(markerPath)).toBe(true);

    const cap = captureOutput();
    const exit = await removeApiCommand({ api: "tiny", yes: true, json: true, dbPath });
    cap.restore();

    expect(exit).toBe(0);
    expect(existsSync(markerPath)).toBe(false);
    const env = JSON.parse(cap.out.trim());
    expect(env.data.clearedCurrent).toBe(true);
  });

  test("requires --yes in non-json mode (returns 1, prints preview)", async () => {
    const apiDir = join(workspace, "apis", "tiny");
    const cap = captureOutput();
    const exit = await removeApiCommand({ api: "tiny", json: false, dbPath });
    cap.restore();

    expect(exit).toBe(1);
    expect(existsSync(apiDir)).toBe(true);
    expect(cap.err).toContain("Pass --yes to confirm");
    expect(cap.err).toContain("apis/tiny");
  });
});

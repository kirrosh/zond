import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMeta, writeMeta, hashSpec } from "../../../src/core/meta/meta-store.ts";
import type { ZondMeta } from "../../../src/core/meta/types.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "zond-meta-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("meta-store", () => {
  test("readMeta returns null when file is absent", async () => {
    expect(await readMeta(workDir)).toBeNull();
  });

  test("write/read round-trip preserves all fields", async () => {
    const meta: ZondMeta = {
      zondVersion: "0.21.0",
      lastSyncedAt: "2026-04-26T10:00:00.000Z",
      specHash: hashSpec("openapi: 3.0.0"),
      files: {
        "smoke-users.yaml": {
          generatedAt: "2026-04-26T10:00:00.000Z",
          zondVersion: "0.21.0",
          suiteType: "smoke",
          tag: "users",
          endpoints: ["GET /users", "GET /users/{*}"],
        },
      },
    };
    await writeMeta(workDir, meta);
    const loaded = await readMeta(workDir);
    expect(loaded).toEqual(meta);
  });

  test("readMeta tolerates legacy specUrl field on disk (forward-compat)", async () => {
    // Old .zond-meta.json files written before specUrl was dropped: must load fine.
    const legacyJson = JSON.stringify({
      zondVersion: "0.20.0",
      lastSyncedAt: "2026-03-01T00:00:00.000Z",
      specUrl: "openapi.yaml", // legacy field, ignored
      specHash: "deadbeef",
      files: {},
    });
    await writeFile(join(workDir, ".zond-meta.json"), legacyJson, "utf8");

    const loaded = await readMeta(workDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.zondVersion).toBe("0.20.0");
    expect(loaded!.specHash).toBe("deadbeef");
    // specUrl is read into the object (JSON tolerates extra keys), but the typed
    // contract no longer exposes it; subsequent writeMeta will not preserve it.
  });

  test("writeMeta over a legacy file removes the specUrl field on disk", async () => {
    const legacyJson = JSON.stringify({
      zondVersion: "0.20.0",
      lastSyncedAt: "2026-03-01T00:00:00.000Z",
      specUrl: "openapi.yaml",
      specHash: "old",
      files: {},
    });
    await writeFile(join(workDir, ".zond-meta.json"), legacyJson, "utf8");

    await writeMeta(workDir, {
      zondVersion: "0.21.0",
      lastSyncedAt: "2026-04-26T00:00:00.000Z",
      specHash: "new",
      files: {},
    });

    const raw = await Bun.file(join(workDir, ".zond-meta.json")).text();
    expect(raw).not.toContain("specUrl");
    expect(raw).toContain("\"specHash\": \"new\"");
  });

  test("hashSpec is deterministic and SHA-256 hex", () => {
    const a = hashSpec("openapi: 3.0.0");
    const b = hashSpec("openapi: 3.0.0");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

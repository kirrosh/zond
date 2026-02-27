import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import { getDb, closeDb } from "../../src/db/schema.ts";
import {
  upsertEnvironment,
  getEnvironment,
  listEnvironments,
  listEnvironmentRecords,
  getEnvironmentById,
  deleteEnvironment,
} from "../../src/db/queries.ts";

function tmpDbPath(): string {
  return join(tmpdir(), `apitool-env-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function tryUnlink(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

let dbPath: string;

beforeEach(() => {
  dbPath = tmpDbPath();
  getDb(dbPath);
});

afterEach(() => {
  closeDb();
  tryUnlink(dbPath);
});

describe("upsertEnvironment", () => {
  test("creates a new environment", () => {
    upsertEnvironment("dev", { BASE_URL: "http://localhost:3000" });
    expect(getEnvironment("dev")).toEqual({ BASE_URL: "http://localhost:3000" });
  });

  test("updates existing environment on conflict", () => {
    upsertEnvironment("dev", { BASE_URL: "http://old" });
    upsertEnvironment("dev", { BASE_URL: "http://new", TOKEN: "abc" });
    expect(getEnvironment("dev")).toEqual({ BASE_URL: "http://new", TOKEN: "abc" });
  });
});

describe("getEnvironment", () => {
  test("returns variables for existing env", () => {
    upsertEnvironment("staging", { API_KEY: "key123" });
    expect(getEnvironment("staging")).toEqual({ API_KEY: "key123" });
  });

  test("returns null for non-existent env", () => {
    expect(getEnvironment("nonexistent")).toBeNull();
  });
});

describe("getEnvironmentById", () => {
  test("returns full record for existing env", () => {
    upsertEnvironment("prod", { BASE_URL: "https://prod.example.com" });
    const records = listEnvironmentRecords();
    const id = records[0]!.id;

    const env = getEnvironmentById(id);
    expect(env).not.toBeNull();
    expect(env!.name).toBe("prod");
    expect(env!.variables).toEqual({ BASE_URL: "https://prod.example.com" });
    expect(env!.id).toBe(id);
  });

  test("returns null for non-existent id", () => {
    expect(getEnvironmentById(9999)).toBeNull();
  });
});

describe("listEnvironments", () => {
  test("returns sorted names", () => {
    upsertEnvironment("staging", {});
    upsertEnvironment("dev", {});
    upsertEnvironment("prod", {});
    expect(listEnvironments()).toEqual(["dev", "prod", "staging"]);
  });

  test("returns empty array when none exist", () => {
    expect(listEnvironments()).toEqual([]);
  });
});

describe("listEnvironmentRecords", () => {
  test("returns full records with parsed variables", () => {
    upsertEnvironment("dev", { BASE_URL: "http://localhost" });
    upsertEnvironment("prod", { BASE_URL: "https://prod.com", TOKEN: "xyz" });

    const records = listEnvironmentRecords();
    expect(records).toHaveLength(2);
    expect(records[0]!.name).toBe("dev");
    expect(records[0]!.variables).toEqual({ BASE_URL: "http://localhost" });
    expect(records[1]!.name).toBe("prod");
    expect(records[1]!.variables).toEqual({ BASE_URL: "https://prod.com", TOKEN: "xyz" });
    expect(typeof records[0]!.id).toBe("number");
  });
});

describe("deleteEnvironment", () => {
  test("deletes existing environment and returns true", () => {
    upsertEnvironment("dev", { BASE_URL: "http://localhost" });
    const records = listEnvironmentRecords();
    const id = records[0]!.id;

    expect(deleteEnvironment(id)).toBe(true);
    expect(getEnvironmentById(id)).toBeNull();
    expect(listEnvironments()).toEqual([]);
  });

  test("returns false for non-existent id", () => {
    expect(deleteEnvironment(9999)).toBe(false);
  });

  test("does not affect other environments", () => {
    upsertEnvironment("dev", {});
    upsertEnvironment("prod", {});
    const records = listEnvironmentRecords();
    const devId = records.find(r => r.name === "dev")!.id;

    deleteEnvironment(devId);
    expect(listEnvironments()).toEqual(["prod"]);
  });
});

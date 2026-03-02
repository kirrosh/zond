import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, writeFileSync } from "fs";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { upsertEnvironment, getEnvironment } from "../../src/db/queries.ts";
import { envsCommand, parseKeyValuePairs, parseYamlEnv, toYaml } from "../../src/cli/commands/envs.ts";

function tmpDb(): string {
  return join(tmpdir(), `apitool-envs-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function tryUnlink(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe("parseKeyValuePairs", () => {
  test("parses KEY=VALUE strings", () => {
    expect(parseKeyValuePairs(["base_url=https://api.example.com", "token=abc"])).toEqual({
      base_url: "https://api.example.com",
      token: "abc",
    });
  });

  test("handles = in value", () => {
    expect(parseKeyValuePairs(["key=val=ue"])).toEqual({ key: "val=ue" });
  });

  test("skips invalid pairs", () => {
    expect(parseKeyValuePairs(["noeq", "good=yes"])).toEqual({ good: "yes" });
  });
});

describe("envsCommand", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDb();
    getDb(dbPath);
  });

  afterEach(() => {
    closeDb();
    tryUnlink(dbPath);
  });

  test("list shows empty message when no envs", () => {
    const code = envsCommand({ action: "list", dbPath });
    expect(code).toBe(0);
  });

  test("list shows environments", () => {
    upsertEnvironment("dev", { base_url: "http://localhost" });
    const code = envsCommand({ action: "list", dbPath });
    expect(code).toBe(0);
  });

  test("get returns variables", () => {
    upsertEnvironment("staging", { base_url: "https://staging.api.com", token: "abc" });
    const code = envsCommand({ action: "get", name: "staging", dbPath });
    expect(code).toBe(0);
  });

  test("get returns 1 for missing env", () => {
    const code = envsCommand({ action: "get", name: "nonexistent", dbPath });
    expect(code).toBe(1);
  });

  test("get returns 2 without name", () => {
    const code = envsCommand({ action: "get", dbPath });
    expect(code).toBe(2);
  });

  test("set creates environment", () => {
    const code = envsCommand({ action: "set", name: "prod", pairs: ["base_url=https://prod.api.com"], dbPath });
    expect(code).toBe(0);
    // Verify via get
    const code2 = envsCommand({ action: "get", name: "prod", dbPath });
    expect(code2).toBe(0);
  });

  test("set returns 2 without name", () => {
    const code = envsCommand({ action: "set", pairs: ["k=v"], dbPath });
    expect(code).toBe(2);
  });

  test("set returns 2 without pairs", () => {
    const code = envsCommand({ action: "set", name: "prod", dbPath });
    expect(code).toBe(2);
  });

  test("delete removes environment", () => {
    upsertEnvironment("tmp", { key: "val" });
    const code = envsCommand({ action: "delete", name: "tmp", dbPath });
    expect(code).toBe(0);
    // Verify deleted
    const code2 = envsCommand({ action: "get", name: "tmp", dbPath });
    expect(code2).toBe(1);
  });

  test("delete returns 1 for missing env", () => {
    const code = envsCommand({ action: "delete", name: "ghost", dbPath });
    expect(code).toBe(1);
  });

  test("import loads YAML file into DB", () => {
    const yamlFile = join(tmpdir(), `apitool-import-${Date.now()}.yaml`);
    writeFileSync(yamlFile, "base_url: https://api.example.com\ntoken: secret123\n");
    try {
      const code = envsCommand({ action: "import", name: "imported", file: yamlFile, dbPath });
      expect(code).toBe(0);
      const vars = getEnvironment("imported");
      expect(vars).toEqual({ base_url: "https://api.example.com", token: "secret123" });
    } finally {
      try { unlinkSync(yamlFile); } catch {}
    }
  });

  test("import returns 2 without name", () => {
    const code = envsCommand({ action: "import", file: "some.yaml", dbPath });
    expect(code).toBe(2);
  });

  test("import returns 2 without file", () => {
    const code = envsCommand({ action: "import", name: "test", dbPath });
    expect(code).toBe(2);
  });

  test("import returns 1 for nonexistent file", () => {
    const code = envsCommand({ action: "import", name: "test", file: "/nonexistent/file.yaml", dbPath });
    expect(code).toBe(1);
  });

  test("export outputs YAML", () => {
    upsertEnvironment("exportme", { base: "http://localhost", key: "val" });
    const code = envsCommand({ action: "export", name: "exportme", dbPath });
    expect(code).toBe(0);
  });

  test("export returns 1 for missing env", () => {
    const code = envsCommand({ action: "export", name: "ghost", dbPath });
    expect(code).toBe(1);
  });

  test("export returns 2 without name", () => {
    const code = envsCommand({ action: "export", dbPath });
    expect(code).toBe(2);
  });
});

describe("parseYamlEnv", () => {
  test("parses simple key: value pairs", () => {
    expect(parseYamlEnv("base: http://localhost\ntoken: abc")).toEqual({
      base: "http://localhost",
      token: "abc",
    });
  });

  test("strips quotes", () => {
    expect(parseYamlEnv('key: "hello world"')).toEqual({ key: "hello world" });
  });

  test("skips comments and blank lines", () => {
    expect(parseYamlEnv("# comment\n\nkey: val")).toEqual({ key: "val" });
  });
});

describe("toYaml", () => {
  test("serializes flat record", () => {
    const yaml = toYaml({ name: "dev", token: "abc" });
    expect(yaml).toContain("name: dev");
    expect(yaml).toContain("token: abc");
  });

  test("quotes values with special chars", () => {
    const yaml = toYaml({ url: "http://host:3000/path" });
    expect(yaml).toContain('"http://host:3000/path"');
  });
});

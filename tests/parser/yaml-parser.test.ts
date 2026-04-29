import { describe, test, expect } from "bun:test";
import { parseFile, parseDirectory, parse, parseSafe } from "../../src/core/parser/yaml-parser.ts";

const fixturesDir = `${import.meta.dir}/../fixtures`;

describe("parseFile", () => {
  test("parses simple.yaml correctly", async () => {
    const suite = await parseFile(`${fixturesDir}/simple.yaml`);
    expect(suite.name).toBe("Health Check");
    expect(suite.tests).toHaveLength(1);
    expect(suite.tests[0]!.method).toBe("GET");
    expect(suite.tests[0]!.path).toBe("/health");
    expect(suite.tests[0]!.expect.status).toBe(200);
  });

  test("parses crud.yaml with all fields", async () => {
    const suite = await parseFile(`${fixturesDir}/crud.yaml`);
    expect(suite.name).toBe("Users CRUD");
    expect(suite.base_url).toBe("{{base}}");
    expect(suite.headers!["Authorization"]).toBe("Bearer {{token}}");
    expect(suite.config.timeout).toBe(10000);
    expect(suite.config.retries).toBe(1);
    expect(suite.tests).toHaveLength(3);

    // Check first step
    const createStep = suite.tests[0]!;
    expect(createStep.method).toBe("POST");
    expect(createStep.path).toBe("/users");
    expect(createStep.expect.body!["id"]!.capture).toBe("user_id");
    expect(createStep.expect.body!["id"]!.type).toBe("integer");
  });

  test("throws on invalid YAML (missing name)", async () => {
    await expect(parseFile(`${fixturesDir}/invalid-missing-name.yaml`)).rejects.toThrow(/Validation error/);
  });

  test("throws on invalid YAML (no method)", async () => {
    await expect(parseFile(`${fixturesDir}/invalid-no-method.yaml`)).rejects.toThrow(/Validation error/);
  });

  test("throws on non-existent file", async () => {
    await expect(parseFile(`${fixturesDir}/nonexistent.yaml`)).rejects.toThrow(/Failed to read/);
  });
});

describe("parseDirectory", () => {
  test("parses valid yaml files in a clean directory", async () => {
    const tmpDir = `${fixturesDir}/valid`;
    const { mkdirSync, existsSync } = await import("node:fs");
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    await Bun.write(`${tmpDir}/a.yaml`, "name: A\ntests:\n  - name: A\n    GET: /a\n    expect: {}\n");
    await Bun.write(`${tmpDir}/b.yml`, "name: B\ntests:\n  - name: B\n    POST: /b\n    expect: {}\n");
    // .env.yaml should be excluded (dotfile, not scanned by default)
    await Bun.write(`${tmpDir}/.env.yaml`, "base: http://localhost\n");

    const suites = await parseDirectory(tmpDir);
    expect(suites).toHaveLength(2);
    const names = suites.map((s) => s.name).sort();
    expect(names).toEqual(["A", "B"]);
  });
});

describe("parse", () => {
  test("parse single file returns array of one suite", async () => {
    const suites = await parse(`${fixturesDir}/simple.yaml`);
    expect(suites).toHaveLength(1);
    expect(suites[0]!.name).toBe("Health Check");
  });
});

describe("parseSafe", () => {
  test("returns parse errors instead of silently dropping bad files", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmpDir = mkdtempSync(join(tmpdir(), "zond-parsesafe-"));
    try {
      await Bun.write(`${tmpDir}/ok.yaml`, "name: OK\ntests:\n  - name: T\n    GET: /x\n    expect: {}\n");
      await Bun.write(`${tmpDir}/broken.yaml`, "name: B\ntests:\n  - this is: { not valid yaml\n");

      const result = await parseSafe(tmpDir);
      expect(result.suites).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.file).toContain("broken.yaml");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("single file: parse error surfaces in errors, suites empty", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmpDir = mkdtempSync(join(tmpdir(), "zond-parsesafe-"));
    try {
      const broken = `${tmpDir}/bad.yaml`;
      await Bun.write(broken, ":\n: invalid\n");

      const result = await parseSafe(broken);
      expect(result.suites).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

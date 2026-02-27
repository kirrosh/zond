import { describe, test, expect, mock, afterEach, beforeEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { rm } from "fs/promises";
import { generateCommand } from "../../src/cli/commands/generate.ts";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { getEnvironment } from "../../src/db/queries.ts";
import { isRelativeUrl, sanitizeEnvName } from "../../src/core/generator/skeleton.ts";

const FIXTURE_AUTH = `${import.meta.dir}/../fixtures/petstore-auth.json`;

function suppressOutput() {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = mock(() => true) as typeof process.stdout.write;
  process.stderr.write = mock(() => true) as typeof process.stderr.write;
  return () => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  };
}

describe("isRelativeUrl", () => {
  test("returns true for path starting with /", () => {
    expect(isRelativeUrl("/api/v1")).toBe(true);
    expect(isRelativeUrl("/docgen2/rest")).toBe(true);
  });

  test("returns false for absolute URL", () => {
    expect(isRelativeUrl("https://api.example.com")).toBe(false);
    expect(isRelativeUrl("http://localhost:3000")).toBe(false);
  });

  test("returns false for URL with protocol in path", () => {
    expect(isRelativeUrl("/path://something")).toBe(false);
  });
});

describe("sanitizeEnvName", () => {
  test("converts to lowercase and replaces special chars", () => {
    expect(sanitizeEnvName("My API Service")).toBe("my-api-service");
  });

  test("removes leading/trailing dashes", () => {
    expect(sanitizeEnvName("--test--")).toBe("test");
  });

  test("truncates to 30 characters", () => {
    const long = "a".repeat(50);
    expect(sanitizeEnvName(long).length).toBeLessThanOrEqual(30);
  });

  test("handles special characters", () => {
    expect(sanitizeEnvName("API v2.0 (Beta)")).toBe("api-v2-0-beta");
  });
});

describe("generate command — environment in DB", () => {
  let tmpDir: string;
  let dbPath: string;
  let restore: () => void;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `apitool-gen-env-${Date.now()}`);
    dbPath = join(tmpDir, "test.db");
    restore = suppressOutput();
  });

  afterEach(async () => {
    restore();
    closeDb();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("generate with bearer auth creates env with auth placeholders", async () => {
    const code = await generateCommand({
      from: FIXTURE_AUTH,
      output: join(tmpDir, "tests"),
      dbPath,
      noWizard: true,
    });

    expect(code).toBe(0);

    getDb(dbPath);
    const env = getEnvironment("test-petstore");
    expect(env).not.toBeNull();
    expect(env!.base_url).toBe("http://localhost:3000");
    expect(env!.auth_username).toBe("admin");
    expect(env!.auth_password).toBe("admin");
  });

  test("generate with --auth-token saves token in env", async () => {
    const code = await generateCommand({
      from: FIXTURE_AUTH,
      output: join(tmpDir, "tests"),
      dbPath,
      authToken: "my-secret-token",
      noWizard: true,
    });

    expect(code).toBe(0);

    getDb(dbPath);
    const env = getEnvironment("test-petstore");
    expect(env).not.toBeNull();
    expect(env!.auth_token).toBe("my-secret-token");
    // When auth_token is explicitly provided, no username/password placeholders
    expect(env!.auth_username).toBeUndefined();
  });

  test("generate with --env-name uses custom env name", async () => {
    const code = await generateCommand({
      from: FIXTURE_AUTH,
      output: join(tmpDir, "tests"),
      dbPath,
      envName: "staging",
      noWizard: true,
    });

    expect(code).toBe(0);

    getDb(dbPath);
    const env = getEnvironment("staging");
    expect(env).not.toBeNull();
    expect(env!.base_url).toBe("http://localhost:3000");
  });
});

import { describe, test, expect, mock, afterEach } from "bun:test";
import { catalogCommand } from "../../src/cli/commands/catalog.ts";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

const FIXTURES = `${import.meta.dir}/../fixtures`;

function suppressOutput() {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const origLog = console.log;
  let captured = "";
  process.stdout.write = mock((data: any) => { captured += String(data); return true; }) as typeof process.stdout.write;
  process.stderr.write = mock(() => true) as typeof process.stderr.write;
  console.log = mock((...args: unknown[]) => { captured += args.map(String).join(" ") + "\n"; });
  return {
    restore() {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      console.log = origLog;
    },
    getCaptured() { return captured; },
  };
}

describe("catalogCommand", () => {
  let output: ReturnType<typeof suppressOutput>;
  let tmpDir: string;

  afterEach(async () => {
    output?.restore();
    if (tmpDir) {
      try { await rm(tmpDir, { recursive: true }); } catch {}
    }
  });

  test("generates .api-catalog.yaml from spec", async () => {
    output = suppressOutput();
    tmpDir = await mkdtemp(join(tmpdir(), "zond-catalog-"));

    const code = await catalogCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
      output: tmpDir,
    });

    expect(code).toBe(0);

    const catalogFile = Bun.file(join(tmpDir, ".api-catalog.yaml"));
    expect(await catalogFile.exists()).toBe(true);

    const content = await catalogFile.text();
    expect(content).toContain("/pets");
    expect(content).toContain("GET");
    expect(content).toContain("POST");
    expect(content).toContain("Petstore");
  });

  test("--json returns envelope with ok: true", async () => {
    output = suppressOutput();
    tmpDir = await mkdtemp(join(tmpdir(), "zond-catalog-"));

    const code = await catalogCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
      output: tmpDir,
      json: true,
    });

    expect(code).toBe(0);
    const envelope = JSON.parse(output.getCaptured());
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("catalog");
    expect(envelope.data.endpointCount).toBeGreaterThan(0);
    expect(envelope.data.path).toContain(".api-catalog.yaml");
  });

  test("returns error for invalid spec path", async () => {
    output = suppressOutput();
    const code = await catalogCommand({
      specPath: "/nonexistent/spec.json",
      json: true,
    });

    expect(code).toBe(2);
    const envelope = JSON.parse(output.getCaptured());
    expect(envelope.ok).toBe(false);
  });

  test("generated YAML is parseable and contains expected endpoints", async () => {
    output = suppressOutput();
    tmpDir = await mkdtemp(join(tmpdir(), "zond-catalog-"));

    await catalogCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
      output: tmpDir,
    });

    const content = await Bun.file(join(tmpDir, ".api-catalog.yaml")).text();
    const parsed = Bun.YAML.parse(content) as Record<string, unknown>;

    expect(parsed.apiName).toBe("Simple Petstore");
    expect(parsed.endpointCount).toBe(4); // GET /pets, POST /pets, GET /pets/{petId}, DELETE /pets/{petId}
    expect(parsed.baseUrl).toBe("http://localhost:3000");

    const endpoints = parsed.endpoints as Array<Record<string, unknown>>;
    const paths = endpoints.map(e => `${e.method} ${e.path}`);
    expect(paths).toContain("GET /pets");
    expect(paths).toContain("POST /pets");
    expect(paths).toContain("GET /pets/{petId}");
    expect(paths).toContain("DELETE /pets/{petId}");
  });

  test("defaults output to current directory", async () => {
    output = suppressOutput();
    // Use a temp dir as "current" by specifying it as output
    tmpDir = await mkdtemp(join(tmpdir(), "zond-catalog-"));

    const code = await catalogCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
      output: tmpDir,
    });

    expect(code).toBe(0);
    expect(await Bun.file(join(tmpDir, ".api-catalog.yaml")).exists()).toBe(true);
  });
});

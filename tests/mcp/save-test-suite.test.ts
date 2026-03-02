import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSaveTestSuiteTool } from "../../src/mcp/tools/save-test-suite.ts";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = join(import.meta.dir, ".tmp-save-test");

describe("MCP save_test_suite", () => {
  let handler: (args: Record<string, unknown>) => Promise<any>;

  beforeEach(() => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerSaveTestSuiteTool(server);
    handler = (server as any)._registeredTools["save_test_suite"].handler;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  const VALID_YAML = `name: "Test Suite"
base_url: "http://localhost:3000"
tests:
  - name: "Get items"
    GET: "/items"
    expect:
      status: 200
`;

  test("saves valid YAML and returns success", async () => {
    const filePath = join(TEST_DIR, "test.yaml");
    const result = await handler({ filePath, content: VALID_YAML });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.saved).toBe(true);
    expect(parsed.suite.name).toBe("Test Suite");
    expect(parsed.suite.tests).toBe(1);
    expect(existsSync(filePath)).toBe(true);
  });

  test("creates nested directories", async () => {
    const filePath = join(TEST_DIR, "nested", "deep", "test.yaml");
    const result = await handler({ filePath, content: VALID_YAML });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.saved).toBe(true);
    expect(existsSync(filePath)).toBe(true);
  });

  test("rejects invalid YAML syntax", async () => {
    const filePath = join(TEST_DIR, "bad.yaml");
    const result = await handler({ filePath, content: "name: [invalid yaml\n  broken:" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.saved).toBe(false);
    expect(parsed.error).toContain("YAML parse error");
  });

  test("rejects YAML that fails validation", async () => {
    const filePath = join(TEST_DIR, "invalid.yaml");
    const invalidYaml = `name: "Bad Suite"
tests: []
`;
    const result = await handler({ filePath, content: invalidYaml });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.saved).toBe(false);
    expect(parsed.error).toContain("Validation");
  });

  test("refuses to overwrite existing file without flag", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const filePath = join(TEST_DIR, "existing.yaml");
    await Bun.write(filePath, VALID_YAML);

    const result = await handler({ filePath, content: VALID_YAML });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.saved).toBe(false);
    expect(parsed.error).toContain("already exists");
  });

  test("overwrites existing file with overwrite=true", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const filePath = join(TEST_DIR, "existing.yaml");
    await Bun.write(filePath, "old content");

    const result = await handler({ filePath, content: VALID_YAML, overwrite: true });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.saved).toBe(true);
    const content = await Bun.file(filePath).text();
    expect(content).toBe(VALID_YAML);
  });

  test("preserves original YAML content (no re-serialization)", async () => {
    const yamlWithComments = `# This is a test suite
name: "With Comments"
base_url: "http://localhost:3000"
tests:
  - name: "Get items"
    GET: "/items"
    expect:
      status: 200
`;
    const filePath = join(TEST_DIR, "comments.yaml");
    const result = await handler({ filePath, content: yamlWithComments });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.saved).toBe(true);
    const written = await Bun.file(filePath).text();
    expect(written).toBe(yamlWithComments);
  });
});

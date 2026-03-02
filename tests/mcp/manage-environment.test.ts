import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { upsertEnvironment } from "../../src/db/queries.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerManageEnvironmentTool } from "../../src/mcp/tools/manage-environment.ts";

function tmpDb(): string {
  return join(tmpdir(), `apitool-mcp-env-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function tryUnlink(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe("MCP manage_environment", () => {
  let dbPath: string;

  beforeEach(() => {
    closeDb();
    dbPath = tmpDb();
    getDb(dbPath);
  });

  afterEach(() => {
    closeDb();
    tryUnlink(dbPath);
  });

  test("list returns array", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerManageEnvironmentTool(server, dbPath);
    const tool = (server as any)._registeredTools["manage_environment"];
    const result = await tool.handler({ action: "list" });
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("set and get environment", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerManageEnvironmentTool(server, dbPath);
    const tool = (server as any)._registeredTools["manage_environment"];

    // Set
    const setResult = await tool.handler({ action: "set", name: "dev", variables: { base_url: "http://localhost" } });
    const setParsed = JSON.parse(setResult.content[0].text);
    expect(setParsed.success).toBe(true);

    // Get
    const getResult = await tool.handler({ action: "get", name: "dev" });
    const getParsed = JSON.parse(getResult.content[0].text);
    expect(getParsed.name).toBe("dev");
    expect(getParsed.variables.base_url).toBe("http://localhost");
  });

  test("delete environment", async () => {
    upsertEnvironment("tmp", { key: "val" });
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerManageEnvironmentTool(server, dbPath);
    const tool = (server as any)._registeredTools["manage_environment"];

    const result = await tool.handler({ action: "delete", name: "tmp" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.deleted).toBe("tmp");
  });

  test("get missing env returns error", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerManageEnvironmentTool(server, dbPath);
    const tool = (server as any)._registeredTools["manage_environment"];

    const result = await tool.handler({ action: "get", name: "ghost" });
    expect(result.isError).toBe(true);
  });

  test("delete missing env returns error", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerManageEnvironmentTool(server, dbPath);
    const tool = (server as any)._registeredTools["manage_environment"];

    const result = await tool.handler({ action: "delete", name: "ghost" });
    expect(result.isError).toBe(true);
  });
});

import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";

mock.module("../../src/core/runner/http-client.ts", () => ({
  executeRequest: mock(() => Promise.resolve({
    status: 200,
    headers: { "content-type": "application/json" },
    body: '{"ok":true}',
    body_parsed: { ok: true },
    duration_ms: 55,
  })),
  DEFAULT_FETCH_OPTIONS: { timeout: 30000, retries: 0, retry_delay: 1000, follow_redirects: true },
}));

const mockLoadEnvironment = mock((_envName?: string, _searchDir?: string) => Promise.resolve({ base_url: "https://api.test.com" }));

mock.module("../../src/core/parser/variables.ts", () => ({
  loadEnvironment: mockLoadEnvironment,
  substituteString: mock((template: string, vars: Record<string, unknown>) => {
    if (typeof template !== "string") return template;
    return template.replace(/\{\{(.+?)\}\}/g, (_, key: string) => String(vars[key] ?? `{{${key}}}`));
  }),
  substituteDeep: mock((value: any, vars: Record<string, unknown>) => {
    if (typeof value === "object" && value !== null) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = typeof v === "string"
          ? v.replace(/\{\{(.+?)\}\}/g, (_, key: string) => String(vars[key] ?? `{{${key}}}`))
          : v;
      }
      return result;
    }
    return value;
  }),
  GENERATORS: {},
}));

const mockFindCollectionByNameOrId = mock((_nameOrId: string | number) => ({
  id: 1,
  name: "myapi",
  base_dir: "/projects/myapi",
  test_path: "/projects/myapi/tests",
  openapi_spec: null,
  created_at: "2024-01-01T00:00:00.000Z",
}));

mock.module("../../src/db/queries.ts", () => ({
  findCollectionByNameOrId: mockFindCollectionByNameOrId,
}));

mock.module("../../src/db/schema.ts", () => ({
  getDb: mock(() => ({})),
}));

afterAll(() => { mock.restore(); });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSendRequestTool } from "../../src/mcp/tools/send-request.ts";
import { executeRequest } from "../../src/core/runner/http-client.ts";

describe("MCP send_request", () => {
  beforeEach(() => {
    (executeRequest as ReturnType<typeof mock>).mockClear();
  });

  test("registers and handles GET request", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerSendRequestTool(server);

    const tool = (server as any)._registeredTools["send_request"];
    expect(tool).toBeDefined();

    const result = await tool.handler({ method: "GET", url: "https://api.test.com/data" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe(200);
    expect(parsed.duration_ms).toBe(55);
  });

  test("interpolates variables from environment", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerSendRequestTool(server);

    const tool = (server as any)._registeredTools["send_request"];
    await tool.handler({ method: "GET", url: "{{base_url}}/users", envName: "dev" });
    expect(executeRequest).toHaveBeenCalledTimes(1);
  });

  test("uses collection base_dir as searchDir when collectionName is given", async () => {
    mockLoadEnvironment.mockClear();
    mockFindCollectionByNameOrId.mockClear();

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerSendRequestTool(server);

    const tool = (server as any)._registeredTools["send_request"];
    await tool.handler({ method: "GET", url: "{{base_url}}/health", collectionName: "myapi" });

    expect(mockFindCollectionByNameOrId).toHaveBeenCalledWith("myapi");
    expect(mockLoadEnvironment).toHaveBeenCalledWith(undefined, "/projects/myapi");
  });

  test("returns error on failure", async () => {
    (executeRequest as ReturnType<typeof mock>).mockRejectedValueOnce(new Error("timeout"));
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerSendRequestTool(server);

    const tool = (server as any)._registeredTools["send_request"];
    const result = await tool.handler({ method: "GET", url: "https://bad.host/" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("timeout");
  });
});

import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockListEnvRecords = mock(() => [
  { id: 1, name: "staging", variables: { base_url: "https://staging.api.com" } },
]);
const mockGetEnv = mock((): unknown => ({ base_url: "https://staging.api.com", api_key: "sk-123" }));
const mockUpsertEnv = mock(() => {});

mock.module("../../../src/db/queries.ts", () => ({
  listEnvironmentRecords: mockListEnvRecords,
  getEnvironment: mockGetEnv,
  upsertEnvironment: mockUpsertEnv,
}));

mock.module("../../../src/db/schema.ts", () => ({
  getDb: mock(() => ({})),
}));

import { manageEnvironmentTool } from "../../../src/core/agent/tools/manage-environment.ts";

const toolOpts = { toolCallId: "test", messages: [] as any[] };

describe("manageEnvironmentTool", () => {
  beforeEach(() => {
    mockListEnvRecords.mockClear();
    mockGetEnv.mockClear();
    mockUpsertEnv.mockClear();
  });

  test("is an AI SDK v6 tool with inputSchema", () => {
    expect(manageEnvironmentTool).toHaveProperty("inputSchema");
    expect(manageEnvironmentTool).toHaveProperty("execute");
  });

  test("list action returns environments", async () => {
    const result = await manageEnvironmentTool.execute!({ action: "list" }, toolOpts);
    expect(result).toEqual({
      environments: [{ id: 1, name: "staging", variables: { base_url: "https://staging.api.com" } }],
    });
  });

  test("get action returns environment variables", async () => {
    const result = await manageEnvironmentTool.execute!({ action: "get", name: "staging" }, toolOpts);
    expect(result).toEqual({
      name: "staging",
      variables: { base_url: "https://staging.api.com", api_key: "sk-123" },
    });
    expect(mockGetEnv).toHaveBeenCalledWith("staging");
  });

  test("get action returns error for missing environment", async () => {
    mockGetEnv.mockReturnValueOnce(null);
    const result = await manageEnvironmentTool.execute!({ action: "get", name: "prod" }, toolOpts);
    expect(result).toEqual({ error: "Environment 'prod' not found" });
  });

  test("set action upserts environment", async () => {
    const result = await manageEnvironmentTool.execute!({
      action: "set",
      name: "prod",
      variables: { base_url: "https://api.com" },
    }, toolOpts);
    expect(result).toEqual({ success: true, name: "prod" });
    expect(mockUpsertEnv).toHaveBeenCalledWith("prod", { base_url: "https://api.com" });
  });

  test("set action without name returns error", async () => {
    const result = await manageEnvironmentTool.execute!({ action: "set" } as any, toolOpts);
    expect(result).toEqual({ error: "name and variables are required for set action" });
  });

  test("unknown action returns error", async () => {
    const result = await manageEnvironmentTool.execute!({ action: "unknown" as any }, toolOpts);
    expect(result).toEqual({ error: "Unknown action: unknown" });
  });
});

import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";

mock.module("../../../src/core/runner/http-client.ts", () => ({
  executeRequest: mock(() => Promise.resolve({
    status: 200,
    headers: { "content-type": "application/json" },
    body: '{"ok":true}',
    body_parsed: { ok: true },
    duration_ms: 30,
  })),
  DEFAULT_FETCH_OPTIONS: { timeout: 30000, retries: 0, retry_delay: 1000, follow_redirects: true },
}));

mock.module("../../../src/core/parser/variables.ts", () => ({
  loadEnvironment: mock(() => Promise.resolve({ base_url: "https://api.test.com" })),
  substituteString: mock((template: string, vars: Record<string, unknown>) => {
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

afterAll(() => { mock.restore(); });

import { sendRequestTool } from "../../../src/core/agent/tools/send-request.ts";
import { executeRequest } from "../../../src/core/runner/http-client.ts";

const toolOpts = { toolCallId: "test", messages: [] as any[] };

describe("sendRequestTool", () => {
  beforeEach(() => {
    (executeRequest as ReturnType<typeof mock>).mockClear();
  });

  test("is an AI SDK v6 tool with inputSchema", () => {
    expect(sendRequestTool).toHaveProperty("inputSchema");
    expect(sendRequestTool).toHaveProperty("execute");
    expect(sendRequestTool).toHaveProperty("description");
  });

  test("sends request and returns compact result (no headers)", async () => {
    const result = await sendRequestTool.execute!({ method: "GET", url: "https://api.test.com/data" }, toolOpts);
    expect(result).toEqual({
      status: 200,
      body: { ok: true },
      duration_ms: 30,
    });
  });

  test("passes headers and body", async () => {
    await sendRequestTool.execute!({
      method: "POST",
      url: "https://api.test.com/data",
      headers: { "Authorization": "Bearer token" },
      body: '{"name":"test"}',
    }, toolOpts);
    expect(executeRequest).toHaveBeenCalledTimes(1);
    const call = (executeRequest as ReturnType<typeof mock>).mock.calls[0]![0];
    expect(call.method).toBe("POST");
  });

  test("returns error on failure", async () => {
    (executeRequest as ReturnType<typeof mock>).mockRejectedValueOnce(new Error("connection refused"));
    const result = await sendRequestTool.execute!({ method: "GET", url: "https://bad.host/" }, toolOpts);
    expect(result).toEqual({ error: "connection refused" });
  });
});

import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock executeRequest before importing
mock.module("../../src/core/runner/http-client.ts", () => ({
  executeRequest: mock(() => Promise.resolve({
    status: 200,
    headers: { "content-type": "application/json" },
    body: '{"id":1,"name":"test"}',
    body_parsed: { id: 1, name: "test" },
    duration_ms: 42,
  })),
  DEFAULT_FETCH_OPTIONS: { timeout: 30000, retries: 0, retry_delay: 1000, follow_redirects: true },
}));

mock.module("../../src/core/parser/variables.ts", () => ({
  loadEnvironment: mock(() => Promise.resolve({ base_url: "https://api.example.com", auth_token: "tok123" })),
  substituteString: mock((template: string, vars: Record<string, unknown>) => {
    return template.replace(/\{\{(.+?)\}\}/g, (_, key: string) => String(vars[key] ?? `{{${key}}}`));
  }),
}));

import { requestCommand, parseHeaders } from "../../src/cli/commands/request.ts";
import { executeRequest } from "../../src/core/runner/http-client.ts";
import { loadEnvironment } from "../../src/core/parser/variables.ts";

describe("parseHeaders", () => {
  test("parses K:V header strings", () => {
    expect(parseHeaders(["Content-Type: application/json", "Authorization: Bearer tok"])).toEqual({
      "Content-Type": "application/json",
      "Authorization": "Bearer tok",
    });
  });

  test("handles empty and invalid headers", () => {
    expect(parseHeaders(["invalid", "", "X-Foo: bar"])).toEqual({ "X-Foo": "bar" });
  });

  test("handles colons in value", () => {
    expect(parseHeaders(["Authorization: Bearer a:b:c"])).toEqual({ "Authorization": "Bearer a:b:c" });
  });
});

describe("requestCommand", () => {
  beforeEach(() => {
    (executeRequest as ReturnType<typeof mock>).mockClear();
    (loadEnvironment as ReturnType<typeof mock>).mockClear();
  });

  test("sends GET request and returns 0 for success", async () => {
    const code = await requestCommand({
      method: "GET",
      url: "https://api.example.com/users",
      headers: [],
    });
    expect(code).toBe(0);
    expect(executeRequest).toHaveBeenCalledTimes(1);
  });

  test("uses env for variable interpolation", async () => {
    await requestCommand({
      method: "GET",
      url: "{{base_url}}/users",
      headers: ["Authorization: Bearer {{auth_token}}"],
      env: "dev",
    });
    expect(loadEnvironment).toHaveBeenCalledWith("dev");
    const call = (executeRequest as ReturnType<typeof mock>).mock.calls[0]![0];
    expect(call.url).toBe("https://api.example.com/users");
  });

  test("passes timeout to executeRequest", async () => {
    await requestCommand({
      method: "GET",
      url: "https://api.example.com/users",
      headers: [],
      timeout: 5000,
    });
    const call = (executeRequest as ReturnType<typeof mock>).mock.calls[0];
    expect(call![1]).toEqual({ timeout: 5000 });
  });

  test("returns 1 for 4xx/5xx status", async () => {
    (executeRequest as ReturnType<typeof mock>).mockResolvedValueOnce({
      status: 404,
      headers: {},
      body: "Not Found",
      duration_ms: 10,
    });
    const code = await requestCommand({
      method: "GET",
      url: "https://api.example.com/missing",
      headers: [],
    });
    expect(code).toBe(1);
  });

  test("returns 2 on network error", async () => {
    (executeRequest as ReturnType<typeof mock>).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const code = await requestCommand({
      method: "GET",
      url: "https://bad.host/",
      headers: [],
    });
    expect(code).toBe(2);
  });
});

import { describe, test, expect } from "bun:test";
import { buildMessages } from "../../src/core/generator/ai/prompt-builder.ts";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../src/core/generator/openapi-reader.ts";

describe("prompt-builder", () => {
  test("compresses petstore-simple spec to concise text", async () => {
    const doc = await readOpenApiSpec("tests/fixtures/petstore-simple.json");
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);

    const messages = buildMessages(endpoints, securitySchemes, "Create a pet and verify", "http://localhost:3000");

    expect(messages.length).toBe(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.role).toBe("user");

    const userMsg = messages[1]!.content;

    // Should contain endpoint signatures
    expect(userMsg).toContain("GET /pets");
    expect(userMsg).toContain("POST /pets");
    expect(userMsg).toContain("GET /pets/{petId}");
    expect(userMsg).toContain("DELETE /pets/{petId}");

    // Should contain response codes
    expect(userMsg).toContain("201:");
    expect(userMsg).toContain("409:");
    expect(userMsg).toContain("200:");

    // Should contain request body info
    expect(userMsg).toContain("name: string");
    expect(userMsg).toContain("species: string");

    // Should contain the user prompt
    expect(userMsg).toContain("Create a pet and verify");

    // Should contain base URL
    expect(userMsg).toContain("http://localhost:3000");

    // Should be concise — well under 500 lines
    const lines = userMsg.split("\n").length;
    expect(lines).toBeLessThan(100);
  });

  test("includes security info for auth spec", async () => {
    const doc = await readOpenApiSpec("tests/fixtures/petstore-auth.json");
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);

    const messages = buildMessages(endpoints, securitySchemes, "Test CRUD with auth");
    const userMsg = messages[1]!.content;

    expect(userMsg).toContain("SECURITY:");
    expect(userMsg).toContain("bearerAuth");
    expect(userMsg).toContain("bearer");
  });

  test("system prompt defines JSON output format", async () => {
    const messages = buildMessages([], [], "test");
    const systemMsg = messages[0]!.content;

    expect(systemMsg).toContain("suites");
    expect(systemMsg).toContain("capture");
    expect(systemMsg).toContain("expect");
    expect(systemMsg).toContain("JSON");
  });
});

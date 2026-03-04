import { describe, test, expect } from "bun:test";
import { AGENT_SYSTEM_PROMPT } from "../../src/core/agent/system-prompt.ts";

describe("AGENT_SYSTEM_PROMPT", () => {
  test("is a non-empty string", () => {
    expect(typeof AGENT_SYSTEM_PROMPT).toBe("string");
    expect(AGENT_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  test("contains API testing context", () => {
    expect(AGENT_SYSTEM_PROMPT).toContain("API testing");
  });

  test("mentions all tool names", () => {
    const toolNames = [
      "run_tests",
      "validate_tests",
      "query_results",
      "diagnose_failure",
    ];
    for (const name of toolNames) {
      expect(AGENT_SYSTEM_PROMPT).toContain(name);
    }
  });

  test("mentions safe mode", () => {
    expect(AGENT_SYSTEM_PROMPT).toContain("safe mode");
  });

  test("contains tool usage examples", () => {
    expect(AGENT_SYSTEM_PROMPT).toContain("Tool usage examples");
    expect(AGENT_SYSTEM_PROMPT).toContain("list_runs");
    expect(AGENT_SYSTEM_PROMPT).toContain("list_collections");
  });

  test("contains error recovery guidance", () => {
    expect(AGENT_SYSTEM_PROMPT).toContain("validation error");
    expect(AGENT_SYSTEM_PROMPT).toContain("retry");
  });
});

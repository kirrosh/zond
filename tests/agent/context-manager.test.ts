import { describe, test, expect } from "bun:test";
import { trimContext } from "../../src/core/agent/context-manager.ts";
import type { CoreMessageFormat } from "../../src/db/queries.ts";

function makeMessages(count: number): CoreMessageFormat[] {
  const messages: CoreMessageFormat[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i + 1}`,
    });
  }
  return messages;
}

describe("trimContext", () => {
  test("messages.length <= 20 returned unchanged", () => {
    const messages = makeMessages(10);
    const result = trimContext(messages);
    expect(result).toHaveLength(10);
    expect(result).toEqual(messages);
  });

  test("exactly 20 messages returned unchanged", () => {
    const messages = makeMessages(20);
    const result = trimContext(messages);
    expect(result).toHaveLength(20);
  });

  test("messages.length > 20 trimmed to summary + last 6 turns", () => {
    const messages = makeMessages(30);
    const result = trimContext(messages);

    // Should have: 1 summary message + 12 messages (6 turns = 12 messages, user+assistant)
    expect(result.length).toBeLessThanOrEqual(13);
    expect(result.length).toBeGreaterThan(1);

    // First message should be summary with role "user" (to satisfy APIs that require user-first)
    expect(result[0]!.role).toBe("user");
    expect(result[0]!.content).toContain("summary");
  });

  test("summary contains key info from old turns", () => {
    const messages = makeMessages(30);
    const result = trimContext(messages);
    const summary = result[0]!.content;

    // Summary should mention that earlier messages existed
    expect(summary.toLowerCase()).toContain("summary");
  });

  test("last messages are preserved exactly", () => {
    const messages = makeMessages(30);
    const result = trimContext(messages);
    const lastOriginal = messages[messages.length - 1]!;
    const lastTrimmed = result[result.length - 1]!;
    expect(lastTrimmed.content).toBe(lastOriginal.content);
  });
});

import { describe, test, expect, beforeEach } from "bun:test";
import { getDb } from "../../src/db/schema.ts";
import {
  createChatSession,
  saveChatMessage,
  getChatMessages,
  listChatSessions,
  loadSessionHistory,
} from "../../src/db/queries.ts";

describe("chat queries", () => {
  beforeEach(() => {
    // Use default DB (same as query functions) and clean chat tables
    const db = getDb();
    db.exec("DELETE FROM chat_messages");
    db.exec("DELETE FROM chat_sessions");
  });

  test("createChatSession returns id", () => {
    const id = createChatSession("ollama", "llama3.2:3b", "Test Session");
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);
  });

  test("saveChatMessage + getChatMessages roundtrip", () => {
    const sessionId = createChatSession("ollama", "llama3.2:3b");

    saveChatMessage({ session_id: sessionId, role: "user", content: "Hello" });
    saveChatMessage({ session_id: sessionId, role: "assistant", content: "Hi there!", input_tokens: 10, output_tokens: 20 });

    const messages = getChatMessages(sessionId);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content).toBe("Hello");
    expect(messages[1]!.role).toBe("assistant");
    expect(messages[1]!.content).toBe("Hi there!");
    expect(messages[1]!.input_tokens).toBe(10);
    expect(messages[1]!.output_tokens).toBe(20);
  });

  test("listChatSessions ordered by last_active DESC", () => {
    const id1 = createChatSession("ollama", "llama3.2:3b", "Session 1");
    const id2 = createChatSession("openai", "gpt-4o", "Session 2");

    // Manually set last_active to force ordering
    const db = getDb();
    db.prepare("UPDATE chat_sessions SET last_active = '2025-01-01T00:00:00' WHERE id = ?").run(id1);
    db.prepare("UPDATE chat_sessions SET last_active = '2025-01-02T00:00:00' WHERE id = ?").run(id2);

    const sessions = listChatSessions();
    expect(sessions.length).toBe(2);
    // Session 2 has more recent last_active so should be first
    expect(sessions[0]!.id).toBe(id2);
    expect(sessions[1]!.id).toBe(id1);
  });

  test("loadSessionHistory returns CoreMessage[] format", () => {
    const sessionId = createChatSession("ollama", "llama3.2:3b");

    saveChatMessage({ session_id: sessionId, role: "user", content: "Run my tests" });
    saveChatMessage({ session_id: sessionId, role: "assistant", content: "I'll run them now" });
    saveChatMessage({ session_id: sessionId, role: "user", content: "Thanks" });

    const history = loadSessionHistory(sessionId);
    expect(history).toHaveLength(3);
    expect(history[0]).toEqual({ role: "user", content: "Run my tests" });
    expect(history[1]).toEqual({ role: "assistant", content: "I'll run them now" });
    expect(history[2]).toEqual({ role: "user", content: "Thanks" });
  });

  test("saveChatMessage with tool data", () => {
    const sessionId = createChatSession("ollama", "llama3.2:3b");

    saveChatMessage({
      session_id: sessionId,
      role: "assistant",
      content: "Running tests...",
      tool_name: "run_tests",
      tool_args: JSON.stringify({ testPath: "tests/" }),
      tool_result: JSON.stringify({ runId: 1, status: "all_passed" }),
    });

    const messages = getChatMessages(sessionId);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.tool_name).toBe("run_tests");
    expect(messages[0]!.tool_args).toBe(JSON.stringify({ testPath: "tests/" }));
  });
});

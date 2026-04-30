import { describe, test, expect } from "bun:test";
import { getDb } from "../../src/db/schema.ts";

describe("DB schema v3 — chat tables", () => {
  test("migration sets user_version to latest", () => {
    const db = getDb();
    const row = db.query("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBe(3);
  });

  test("chat_sessions table exists", () => {
    const db = getDb();
    const tables = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_sessions'"
    ).all() as { name: string }[];
    expect(tables).toHaveLength(1);
    expect(tables[0]!.name).toBe("chat_sessions");
  });

  test("chat_messages table exists", () => {
    const db = getDb();
    const tables = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'"
    ).all() as { name: string }[];
    expect(tables).toHaveLength(1);
    expect(tables[0]!.name).toBe("chat_messages");
  });

  test("FK constraint: message with invalid session_id fails", () => {
    const db = getDb();
    expect(() => {
      db.prepare(
        "INSERT INTO chat_messages (session_id, role, content) VALUES (99999, 'user', 'hello')"
      ).run();
    }).toThrow();
  });
});

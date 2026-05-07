import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveAdHocRequest,
  sendAdHocRequest,
  extractByPath,
} from "../../src/core/runner/send-request.ts";
import { createCollection } from "../../src/db/queries.ts";
import { closeDb, getDb } from "../../src/db/schema.ts";
import { mockFetchSequence, mockFetchRouter } from "../_helpers/fetch-mock.ts";
import { makeWorkspace, type WorkspaceHandle } from "../_helpers/workspace.ts";
import { tmpDb, unlinkDb } from "../_helpers/tmp-db.ts";

describe("send-request — extractByPath (TASK-200)", () => {
  test("dot path through nested objects", () => {
    expect(extractByPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  test("[i] array index with bracket syntax", () => {
    expect(extractByPath({ items: [{ id: "x" }, { id: "y" }] }, "items[1].id")).toBe("y");
  });

  test("plain numeric segment also indexes arrays", () => {
    expect(extractByPath({ items: [10, 20, 30] }, "items.0")).toBe(10);
  });

  test("array index out of bounds → undefined", () => {
    expect(extractByPath({ xs: [1, 2] }, "xs[5]")).toBeUndefined();
  });

  test("non-numeric segment on array → undefined", () => {
    expect(extractByPath({ xs: [1, 2] }, "xs.foo")).toBeUndefined();
  });

  test("traversal through null → undefined", () => {
    expect(extractByPath({ a: null }, "a.b.c")).toBeUndefined();
  });

  test("traversal through primitive → undefined", () => {
    expect(extractByPath({ a: "string" }, "a.b")).toBeUndefined();
  });

  test("missing intermediate key → undefined", () => {
    expect(extractByPath({ a: { b: 1 } }, "a.x.y")).toBeUndefined();
  });
});

describe("send-request — resolveAdHocRequest (TASK-200)", () => {
  let ws: WorkspaceHandle;
  let dbPath: string;

  beforeEach(() => {
    ws = makeWorkspace({ marker: "config" });
    dbPath = tmpDb("zond-send-req");
  });

  afterEach(() => {
    closeDb();
    unlinkDb(dbPath);
    ws.cleanup();
  });

  test("merges env vars into url/header/body templates", async () => {
    writeFileSync(join(ws.path, ".env.yaml"), "host: api.example.com\ntoken: secret-123\n");
    const resolved = await resolveAdHocRequest({
      method: "POST",
      url: "https://{{host}}/echo",
      headers: { Authorization: "Bearer {{token}}" },
      body: '{"hello":"{{host}}"}',
      searchDir: ws.path,
    });
    expect(resolved.url).toBe("https://api.example.com/echo");
    expect(resolved.headers.Authorization).toBe("Bearer secret-123");
    expect(resolved.body).toBe('{"hello":"api.example.com"}');
  });

  test("auto-prefixes base_url for relative paths when --api is in play", async () => {
    writeFileSync(join(ws.path, ".env.yaml"), "base_url: https://api.example.com/v1/\n");
    getDb(dbPath);
    createCollection({ name: "demo", test_path: ws.path, base_dir: ws.path });
    const resolved = await resolveAdHocRequest({
      method: "GET",
      url: "/users/1",
      collectionName: "demo",
      dbPath,
      searchDir: ws.path,
    });
    // Trailing slash on base_url stripped, single join.
    expect(resolved.url).toBe("https://api.example.com/v1/users/1");
  });

  test("does not touch absolute URLs even when --api is in play", async () => {
    writeFileSync(join(ws.path, ".env.yaml"), "base_url: https://api.example.com\n");
    getDb(dbPath);
    createCollection({ name: "demo", test_path: ws.path, base_dir: ws.path });
    const resolved = await resolveAdHocRequest({
      method: "GET",
      url: "https://other.example.com/x",
      collectionName: "demo",
      dbPath,
      searchDir: ws.path,
    });
    expect(resolved.url).toBe("https://other.example.com/x");
  });

  test("does not double-prefix already-templated {{base_url}} URLs", async () => {
    writeFileSync(join(ws.path, ".env.yaml"), "base_url: https://api.example.com\n");
    getDb(dbPath);
    createCollection({ name: "demo", test_path: ws.path, base_dir: ws.path });
    const resolved = await resolveAdHocRequest({
      method: "GET",
      url: "{{base_url}}/users/1",
      collectionName: "demo",
      dbPath,
      searchDir: ws.path,
    });
    expect(resolved.url).toBe("https://api.example.com/users/1");
  });

  test("auto-detects Content-Type: application/json for JSON bodies", async () => {
    const resolved = await resolveAdHocRequest({
      method: "POST",
      url: "https://example.com/x",
      body: '{"a":1}',
      searchDir: ws.path,
    });
    expect(resolved.headers["Content-Type"]).toBe("application/json");
  });

  test("does not auto-set Content-Type for non-JSON bodies", async () => {
    const resolved = await resolveAdHocRequest({
      method: "POST",
      url: "https://example.com/x",
      body: "raw=plain&text=yes",
      searchDir: ws.path,
    });
    expect(resolved.headers["Content-Type"]).toBeUndefined();
  });

  test("preserves explicit Content-Type and does not override", async () => {
    const resolved = await resolveAdHocRequest({
      method: "POST",
      url: "https://example.com/x",
      headers: { "content-type": "application/xml" },
      body: '{"a":1}',
      searchDir: ws.path,
    });
    expect(resolved.headers["content-type"]).toBe("application/xml");
    expect(resolved.headers["Content-Type"]).toBeUndefined();
  });

  test("extraVars override env vars", async () => {
    writeFileSync(join(ws.path, ".env.yaml"), "user: alice\n");
    const resolved = await resolveAdHocRequest({
      method: "GET",
      url: "https://example.com/{{user}}",
      extraVars: { user: "bob" },
      searchDir: ws.path,
    });
    expect(resolved.url).toBe("https://example.com/bob");
  });

  test("missing collection throws with actionable message", async () => {
    getDb(dbPath);
    await expect(
      resolveAdHocRequest({
        method: "GET",
        url: "/x",
        collectionName: "nope",
        dbPath,
        searchDir: ws.path,
      }),
    ).rejects.toThrow(/API 'nope' is not registered/);
  });
});

describe("send-request — sendAdHocRequest (TASK-200)", () => {
  let ws: WorkspaceHandle;

  beforeEach(() => { ws = makeWorkspace({ marker: "config" }); });
  afterEach(() => { ws.cleanup(); });

  test("returns parsed JSON body, headers and status", async () => {
    const handle = mockFetchSequence([
      { status: 201, body: { id: "u-1", name: "alice" }, headers: { "x-trace": "t-1" } },
    ]);
    try {
      const result = await sendAdHocRequest({
        method: "POST",
        url: "https://example.com/users",
        body: '{"name":"alice"}',
        searchDir: ws.path,
      });
      expect(result.status).toBe(201);
      expect(result.body).toEqual({ id: "u-1", name: "alice" });
      expect(result.headers["x-trace"]).toBe("t-1");
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
      expect(handle.calls).toHaveLength(1);
      expect(handle.calls[0]!.method).toBe("POST");
    } finally {
      handle.restore();
    }
  });

  test("jsonPath: dot-extract from object body", async () => {
    const handle = mockFetchSequence([{ status: 200, body: { user: { id: "u-7" } } }]);
    try {
      const r = await sendAdHocRequest({
        method: "GET",
        url: "https://example.com/me",
        jsonPath: "user.id",
        searchDir: ws.path,
      });
      expect(r.body).toBe("u-7");
    } finally { handle.restore(); }
  });

  test("jsonPath: [i] index-extract from array body", async () => {
    const handle = mockFetchSequence([{ status: 200, body: { items: [{ id: "a" }, { id: "b" }] } }]);
    try {
      const r = await sendAdHocRequest({
        method: "GET",
        url: "https://example.com/list",
        jsonPath: "items[1].id",
        searchDir: ws.path,
      });
      expect(r.body).toBe("b");
    } finally { handle.restore(); }
  });

  test("jsonPath: missing path → undefined body", async () => {
    const handle = mockFetchSequence([{ status: 200, body: { a: 1 } }]);
    try {
      const r = await sendAdHocRequest({
        method: "GET",
        url: "https://example.com/x",
        jsonPath: "does.not.exist",
        searchDir: ws.path,
      });
      expect(r.body).toBeUndefined();
    } finally { handle.restore(); }
  });

  test("propagates fetch errors to caller", async () => {
    const handle = mockFetchRouter(() => { throw new Error("network down"); });
    try {
      await expect(
        sendAdHocRequest({
          method: "GET",
          url: "https://example.com/x",
          searchDir: ws.path,
        }),
      ).rejects.toThrow();
    } finally { handle.restore(); }
  });
});

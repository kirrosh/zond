import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createApp } from "../../src/web/server.ts";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { upsertEnvironment, listEnvironmentRecords } from "../../src/db/queries.ts";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `apitool-web-env-${Date.now()}.db`);

describe("Environments web routes", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    try { unlinkSync(TEST_DB); } catch {}
    getDb(TEST_DB);
    upsertEnvironment("dev", { BASE_URL: "http://localhost:3000", TOKEN: "abc" });
    upsertEnvironment("prod", { BASE_URL: "https://api.example.com" });
    app = createApp({ endpoints: [], specPath: null, servers: [], securitySchemes: [], loginPath: null });
  });

  afterAll(() => {
    closeDb();
    try { unlinkSync(TEST_DB); } catch {}
  });

  // GET /environments
  it("GET /environments returns 200 with environment list", async () => {
    const res = await app.request("/environments");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Environments");
    expect(html).toContain("dev");
    expect(html).toContain("prod");
    expect(html).toContain("2 variables");
    expect(html).toContain("1 variable");
  });

  it("GET /environments as HTMX returns fragment", async () => {
    const res = await app.request("/environments", { headers: { "HX-Request": "true" } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Environments");
    expect(html).not.toContain("<!DOCTYPE html>");
  });

  // GET /environments/:id
  it("GET /environments/:id returns 200 with detail page", async () => {
    const records = listEnvironmentRecords();
    const devEnv = records.find(r => r.name === "dev")!;

    const res = await app.request(`/environments/${devEnv.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("dev");
    expect(html).toContain("BASE_URL");
    expect(html).toContain("http://localhost:3000");
    expect(html).toContain("TOKEN");
  });

  it("GET /environments/:id returns 404 for non-existent", async () => {
    const res = await app.request("/environments/99999");
    expect(res.status).toBe(404);
  });

  it("GET /environments/:id returns 400 for invalid id", async () => {
    const res = await app.request("/environments/abc");
    expect(res.status).toBe(400);
  });

  // POST /environments
  it("POST /environments creates environment and redirects", async () => {
    const form = new URLSearchParams();
    form.set("name", "staging");

    const res = await app.request("/environments", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    expect(res.status).toBe(302);
    // Verify it was created
    const records = listEnvironmentRecords();
    expect(records.some(r => r.name === "staging")).toBe(true);
  });

  it("POST /environments returns 400 for empty name", async () => {
    const form = new URLSearchParams();
    form.set("name", "");

    const res = await app.request("/environments", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    expect(res.status).toBe(400);
  });

  // PUT /environments/:id
  it("PUT /environments/:id updates variables", async () => {
    const records = listEnvironmentRecords();
    const devEnv = records.find(r => r.name === "dev")!;

    const form = new URLSearchParams();
    form.append("key", "BASE_URL");
    form.append("value", "http://updated:3000");
    form.append("key", "NEW_VAR");
    form.append("value", "new_value");

    const res = await app.request(`/environments/${devEnv.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    expect(res.status).toBe(302);
  });

  it("PUT /environments/:id returns 404 for non-existent", async () => {
    const form = new URLSearchParams();
    form.append("key", "X");
    form.append("value", "Y");

    const res = await app.request("/environments/99999", {
      method: "PUT",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    expect(res.status).toBe(404);
  });

  // DELETE /environments/:id
  it("DELETE /environments/:id deletes environment", async () => {
    // Create a temp env to delete
    upsertEnvironment("to-delete", { X: "1" });
    const records = listEnvironmentRecords();
    const env = records.find(r => r.name === "to-delete")!;

    const res = await app.request(`/environments/${env.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const after = listEnvironmentRecords();
    expect(after.some(r => r.name === "to-delete")).toBe(false);
  });

  // Environment selector in collection run button
  it("GET /environments list shows create form", async () => {
    const res = await app.request("/environments");
    const html = await res.text();
    expect(html).toContain("Create Environment");
    expect(html).toContain('name="name"');
  });
});

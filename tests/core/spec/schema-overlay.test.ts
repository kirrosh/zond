/**
 * ARV-176: response-schema overlay — merge patch → overlay, apply onto doc,
 * fill gaps without overwriting (unless --force), skip conflicts.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSchemaOverlay,
  mergePatch,
  saveSchemaOverlay,
  applySchemaOverlay,
  type ResponseSchemaPatch,
} from "../../../src/core/spec/schema-overlay.ts";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "zond-arv176-"));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const CHARGE: ResponseSchemaPatch = {
  "GET /v1/charges/{id}": { "200": { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
};

function doc() {
  return {
    openapi: "3.0.0",
    paths: {
      "/v1/charges/{id}": { get: { responses: { "200": { description: "ok" } } } },
      "/v1/customers/{id}": { get: { responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } } } } },
    },
  };
}

describe("schema overlay persistence (ARV-176)", () => {
  test("save + load round-trips the patch", () => {
    const d = tmp();
    saveSchemaOverlay(d, CHARGE);
    expect(existsSync(join(d, ".api-schema.local.yaml"))).toBe(true);
    expect(loadSchemaOverlay(d)).toEqual(CHARGE);
  });

  test("mergePatch unions, incoming wins on collision", () => {
    const base: ResponseSchemaPatch = { "GET /a": { "200": { type: "string" } } };
    const inc: ResponseSchemaPatch = { "GET /a": { "201": { type: "null" } }, "GET /b": { "200": { type: "integer" } } };
    const m = mergePatch(base, inc);
    expect(Object.keys(m).sort()).toEqual(["GET /a", "GET /b"]);
    expect(m["GET /a"]).toEqual({ "200": { type: "string" }, "201": { type: "null" } });
  });
});

describe("applySchemaOverlay (ARV-176)", () => {
  test("fills a response with no declared schema", () => {
    const d = doc();
    const r = applySchemaOverlay(d, CHARGE);
    expect(r.applied).toEqual(["GET /v1/charges/{id} 200"]);
    const schema = (d.paths["/v1/charges/{id}"].get.responses["200"] as any).content["application/json"].schema;
    expect(schema.required).toEqual(["id"]);
  });

  test("does not overwrite an existing schema without --force", () => {
    const d = doc();
    const patch: ResponseSchemaPatch = { "GET /v1/customers/{id}": { "200": { type: "object", properties: { extra: { type: "string" } } } } };
    const r = applySchemaOverlay(d, patch);
    expect(r.preserved).toEqual(["GET /v1/customers/{id} 200"]);
    expect(r.applied).toEqual([]);
    const schema = (d.paths["/v1/customers/{id}"].get.responses["200"] as any).content["application/json"].schema;
    expect(schema).toEqual({ type: "object" }); // untouched
  });

  test("--force overwrites the existing schema", () => {
    const d = doc();
    const patch: ResponseSchemaPatch = { "GET /v1/customers/{id}": { "200": { type: "object", properties: { extra: { type: "string" } } } } };
    const r = applySchemaOverlay(d, patch, { force: true });
    expect(r.applied).toEqual(["GET /v1/customers/{id} 200"]);
    const schema = (d.paths["/v1/customers/{id}"].get.responses["200"] as any).content["application/json"].schema;
    expect(schema.properties.extra).toEqual({ type: "string" });
  });

  test("endpoint absent from upstream is a conflict, skipped", () => {
    const d = doc();
    const patch: ResponseSchemaPatch = { "GET /v1/gone/{id}": { "200": { type: "object" } } };
    const r = applySchemaOverlay(d, patch);
    expect(r.conflicts).toEqual(["GET /v1/gone/{id} 200"]);
    expect(r.applied).toEqual([]);
  });

  test("AC#2: a subsequent refresh (fresh doc + load overlay) re-applies the schema", () => {
    const dir = tmp();
    saveSchemaOverlay(dir, CHARGE);
    // Simulate `refresh-api` with no --merge-schema: re-pull upstream (a fresh
    // doc with no response schemas) and re-apply whatever the overlay holds.
    const freshDoc = doc();
    const overlay = loadSchemaOverlay(dir)!;
    const r = applySchemaOverlay(freshDoc, overlay);
    expect(r.applied).toEqual(["GET /v1/charges/{id} 200"]);
    const schema = (freshDoc.paths["/v1/charges/{id}"].get.responses["200"] as any).content["application/json"].schema;
    expect(schema.required).toEqual(["id"]);
  });
});

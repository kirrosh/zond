/**
 * Unit tests for `.api-fixtures.yaml` builder. The manifest must list
 * every var the user has to fill in `.env.yaml`, classified by source
 * (server / auth / path / header).
 */

import { describe, expect, test } from "bun:test";
import {
  extractEndpoints,
  extractSecuritySchemes,
  buildApiFixtureManifest,
  buildApiResourceMap,
  serializeApiFixtureManifest,
} from "../../src/core/generator/index.ts";

const SPEC_WITH_AUTH = {
  openapi: "3.0.0",
  info: { title: "test", version: "1.0" },
  servers: [{ url: "https://api.example.com" }],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: "http", scheme: "bearer" },
    },
  },
  paths: {
    "/users/{user_id}": {
      get: {
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "user_id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "X-Trace-Id", in: "header", required: true, schema: { type: "string" } },
        ],
        responses: { "200": {} },
      },
    },
    "/users/{user_id}/orders/{order_id}": {
      get: {
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "user_id", in: "path", required: true, schema: { type: "string" } },
          { name: "order_id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": {} },
      },
    },
  },
};

describe("buildApiFixtureManifest", () => {
  test("emits server + auth + path + header fixtures with correct sources", () => {
    const endpoints = extractEndpoints(SPEC_WITH_AUTH as any);
    const securitySchemes = extractSecuritySchemes(SPEC_WITH_AUTH as any);
    const manifest = buildApiFixtureManifest({
      endpoints,
      securitySchemes,
      baseUrl: "https://api.example.com",
      specHash: "deadbeef",
    });

    expect(manifest.specHash).toBe("deadbeef");
    const byName = Object.fromEntries(manifest.fixtures.map(f => [f.name, f]));

    // server
    expect(byName.base_url).toBeDefined();
    expect(byName.base_url!.source).toBe("server");
    expect(byName.base_url!.defaultValue).toBe("https://api.example.com");

    // auth
    expect(byName.auth_token).toBeDefined();
    expect(byName.auth_token!.source).toBe("auth");
    expect(byName.auth_token!.affectedEndpoints.length).toBeGreaterThan(0);

    // path
    expect(byName.user_id).toBeDefined();
    expect(byName.user_id!.source).toBe("path");
    expect(byName.user_id!.affectedEndpoints.length).toBe(2);
    expect(byName.order_id).toBeDefined();
    expect(byName.order_id!.source).toBe("path");

    // header (lowercased + dash→underscore: x-trace-id → x_trace_id)
    expect(byName.x_trace_id).toBeDefined();
    expect(byName.x_trace_id!.source).toBe("header");
  });

  test("authorization / accept / content-type headers are NOT emitted as fixtures", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "t", version: "1.0" },
      paths: {
        "/x": {
          get: {
            parameters: [
              { name: "Authorization", in: "header", required: true, schema: { type: "string" } },
              { name: "Accept", in: "header", required: true, schema: { type: "string" } },
              { name: "Content-Type", in: "header", required: true, schema: { type: "string" } },
            ],
            responses: { "200": {} },
          },
        },
      },
    };
    const endpoints = extractEndpoints(spec as any);
    const manifest = buildApiFixtureManifest({
      endpoints,
      securitySchemes: [],
      specHash: "x",
    });
    const names = manifest.fixtures.map(f => f.name);
    expect(names).not.toContain("authorization");
    expect(names).not.toContain("accept");
    expect(names).not.toContain("content_type");
  });

  test("body-FK fields from request bodies surface as source: body-fk (ARV-45 AC#5)", () => {
    // Mirrors the AC#5 fixture-test: POST /A {body: {b_id: ref}}, POST /B
    // → manifest contains b_id with source: body-fk + affectedEndpoints
    // includes the create endpoint that consumes it.
    const spec = {
      openapi: "3.0.0",
      info: { title: "t", version: "1.0" },
      paths: {
        "/bs": {
          get: { responses: { "200": { content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } } } } } } },
          post: {
            requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } } },
            responses: { "201": { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } } } },
          },
        },
        "/bs/{id}": {
          get: { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": {} } },
        },
        "/as": {
          post: {
            requestBody: { content: { "application/json": { schema: { type: "object", required: ["b_id"], properties: { b_id: { type: "string" } } } } } },
            responses: { "201": { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } } } },
          },
        },
      },
    };
    const endpoints = extractEndpoints(spec as any);
    const resourceMap = buildApiResourceMap({ endpoints, specHash: "x" });
    const manifest = buildApiFixtureManifest({
      endpoints,
      securitySchemes: [],
      specHash: "x",
      resourceMap,
    });
    const byName = Object.fromEntries(manifest.fixtures.map(f => [f.name, f]));
    expect(byName.b_id).toBeDefined();
    expect(byName.b_id!.source).toBe("body-fk");
    expect(byName.b_id!.required).toBe(true);
    expect(byName.b_id!.affectedEndpoints).toContain("POST /as");
  });

  test("CRUD-chain capture vars surface as source: capture-chain, required: false", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "t", version: "1.0" },
      paths: {
        "/templates": {
          get: { responses: { "200": { content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } } } } } } },
          post: {
            requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } } },
            responses: { "201": { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } } } },
          },
        },
        "/templates/{id}": {
          get: { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": {} } },
          patch: { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": {} } },
        },
      },
    };
    const endpoints = extractEndpoints(spec as any);
    const resourceMap = buildApiResourceMap({ endpoints, specHash: "x" });
    const manifest = buildApiFixtureManifest({
      endpoints,
      securitySchemes: [],
      specHash: "x",
      resourceMap,
    });
    const byName = Object.fromEntries(manifest.fixtures.map(f => [f.name, f]));
    // template_id is the CRUD-chain capture var (resourceVar("templates","id"))
    expect(byName.template_id).toBeDefined();
    expect(byName.template_id!.source).toBe("capture-chain");
    expect(byName.template_id!.required).toBe(false);
    // path-param `id` keeps source=path (more constraining)
    expect(byName.id).toBeDefined();
    expect(byName.id!.source).toBe("path");
  });

  test("body-FK var that is also a path-param keeps source: path (precedence)", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "t", version: "1.0" },
      paths: {
        "/audiences": {
          get: { responses: { "200": { content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } } } } } } },
          post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } } }, responses: { "201": { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } } } } },
        },
        "/audiences/{audience_id}": {
          get: { parameters: [{ name: "audience_id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": {} } },
        },
        "/contacts": {
          post: {
            requestBody: { content: { "application/json": { schema: { type: "object", required: ["audience_id"], properties: { audience_id: { type: "string" } } } } } },
            responses: { "201": {} },
          },
        },
      },
    };
    const endpoints = extractEndpoints(spec as any);
    const resourceMap = buildApiResourceMap({ endpoints, specHash: "x" });
    const manifest = buildApiFixtureManifest({
      endpoints,
      securitySchemes: [],
      specHash: "x",
      resourceMap,
    });
    const byName = Object.fromEntries(manifest.fixtures.map(f => [f.name, f]));
    expect(byName.audience_id).toBeDefined();
    expect(byName.audience_id!.source).toBe("path");
    // affectedEndpoints merges the body-FK consumer (POST /contacts) onto the path entry
    expect(byName.audience_id!.affectedEndpoints).toContain("POST /contacts");
  });

  test("serializeApiFixtureManifest produces stable YAML structure", () => {
    const endpoints = extractEndpoints(SPEC_WITH_AUTH as any);
    const securitySchemes = extractSecuritySchemes(SPEC_WITH_AUTH as any);
    const yaml = serializeApiFixtureManifest(
      buildApiFixtureManifest({ endpoints, securitySchemes, specHash: "x", baseUrl: "https://api.example.com" }),
    );
    expect(yaml).toContain("specHash:");
    expect(yaml).toContain("fixtures:");
    expect(yaml).toContain("source: server");
    expect(yaml).toContain("source: auth");
    expect(yaml).toContain("source: path");
    expect(yaml).not.toContain("undefined");
  });
});

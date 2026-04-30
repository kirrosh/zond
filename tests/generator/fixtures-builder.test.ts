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

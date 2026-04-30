/**
 * Unit tests for `.api-resources.yaml` builder. We feed it a tiny but
 * realistic OpenAPI document and check that CRUD chains, FK
 * dependencies, and orphan endpoints come out the way the scenarios
 * skill expects.
 */

import { describe, expect, test } from "bun:test";
import {
  extractEndpoints,
  buildApiResourceMap,
  serializeApiResourceMap,
} from "../../src/core/generator/index.ts";

const MINI_SPEC = {
  openapi: "3.0.0",
  info: { title: "test", version: "1.0" },
  paths: {
    // Resource with full CRUD: /audiences
    "/audiences": {
      get: { summary: "list", responses: { "200": {} } },
      post: {
        summary: "create",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  id: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "201": {} },
      },
    },
    "/audiences/{audience_id}": {
      get: { summary: "read", responses: { "200": {} } },
      patch: { summary: "update", responses: { "200": {} } },
      delete: { summary: "delete", responses: { "204": {} } },
    },
    // Resource with FK dependency on audience
    "/audiences/{audience_id}/contacts": {
      post: {
        summary: "create contact",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: { email: { type: "string" } },
              },
            },
          },
        },
        responses: { "201": {} },
      },
    },
    "/audiences/{audience_id}/contacts/{contact_id}": {
      get: { summary: "read contact", responses: { "200": {} } },
    },
    // Action endpoint that won't fit any CRUD group
    "/emails/{email_id}/cancel": {
      post: { summary: "cancel", responses: { "200": {} } },
    },
  },
};

describe("buildApiResourceMap", () => {
  test("detects CRUD groups with FK deps and orphan actions", () => {
    const endpoints = extractEndpoints(MINI_SPEC as any);
    const map = buildApiResourceMap({ endpoints, specHash: "deadbeef" });

    expect(map.specHash).toBe("deadbeef");
    expect(map.resourceCount).toBeGreaterThanOrEqual(2);

    const audiences = map.resources.find(r => r.resource === "audiences");
    expect(audiences).toBeDefined();
    expect(audiences!.idParam).toBe("audience_id");
    expect(audiences!.hasFullCrud).toBe(true);
    expect(audiences!.endpoints.list).toBeDefined();
    expect(audiences!.endpoints.delete).toBeDefined();
    expect(audiences!.fkDependencies).toEqual([]); // basePath has no deps

    const contacts = map.resources.find(r => r.resource === "contacts");
    expect(contacts).toBeDefined();
    expect(contacts!.idParam).toBe("contact_id");
    // contacts/{contact_id} sits under /audiences/{audience_id}/, so audience_id is an FK
    expect(contacts!.fkDependencies.map(d => d.var)).toContain("audience_id");
    const audDep = contacts!.fkDependencies.find(d => d.var === "audience_id");
    expect(audDep!.in).toBe("path");
    expect(audDep!.ownerResource).toBe("audiences");

    // /emails/{email_id}/cancel doesn't form a CRUD group → orphan
    expect(map.orphanEndpoints.some(e => e.includes("/emails/{email_id}/cancel"))).toBe(true);
  });

  test("serializeApiResourceMap emits valid YAML with expected fields", () => {
    const endpoints = extractEndpoints(MINI_SPEC as any);
    const map = buildApiResourceMap({ endpoints, specHash: "abc" });
    const yaml = serializeApiResourceMap(map);

    expect(yaml).toContain("specHash:");
    expect(yaml).toContain("resources:");
    expect(yaml).toContain("resource: audiences");
    expect(yaml).toContain("idParam: audience_id");
    expect(yaml).toContain("captureField:");
    expect(yaml).toContain("orphanEndpoints:");
    // No undefined / null leaks
    expect(yaml).not.toContain("undefined");
  });

  test("empty endpoints list serialises with `resources: []`", () => {
    const map = buildApiResourceMap({ endpoints: [], specHash: "x" });
    const yaml = serializeApiResourceMap(map);
    expect(yaml).toContain("resources: []");
    expect(yaml).toContain("orphanEndpoints: []");
  });
});

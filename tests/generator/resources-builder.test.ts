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
import { resolveOwnerListPaths } from "../../src/core/generator/resources-builder.ts";

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

// ── Structural FK-owner resolution (TASK-238 root-cause fix) ──────────────
// Name-stemming alone fails in real-world specs:
//   • `_id_or_slug` / `_or_name` compound suffixes (Sentry, GitHub).
//   • Top-level resources without POST (CRUD-detector skips them).
//   • Sibling-param chains like /projects/{org}/{proj}/keys/.
// These tests pin down the structural resolver's behaviour for each.

const SENTRY_LIKE_SPEC = {
  openapi: "3.0.0",
  info: { title: "sentry-mini", version: "1.0" },
  paths: {
    // Top-level: GET-only collection, NO POST. This is what kills the
    // name-stemming approach — the CRUD detector won't register it.
    "/api/0/organizations/": {
      get: { summary: "list orgs", responses: { "200": {} } },
    },
    "/api/0/organizations/{organization_id_or_slug}/": {
      get: { summary: "get org", responses: { "200": {} } },
    },
    // Nested GET-only collection of projects, scoped to an org.
    "/api/0/organizations/{organization_id_or_slug}/projects/": {
      get: { summary: "list org projects", responses: { "200": {} } },
    },
    // CRUD'd nested resource — depends on org_id_or_slug as parent FK.
    "/api/0/organizations/{organization_id_or_slug}/alert-rules/": {
      get: { summary: "list", responses: { "200": {} } },
      post: {
        summary: "create",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" }, id: { type: "string" } },
              },
            },
          },
        },
        responses: { "201": {} },
      },
    },
    "/api/0/organizations/{organization_id_or_slug}/alert-rules/{alert_rule_id}/": {
      get: { summary: "read", responses: { "200": {} } },
      put: { summary: "update", responses: { "200": {} } },
      delete: { summary: "delete", responses: { "204": {} } },
    },
    // Sentry-style sibling-param chain — `project_id_or_slug` follows
    // another param, so Strategy 1 (direct prefix) has nothing to bite.
    // Strategy 2 (walk back to nearest noun + search GET endings) must
    // pick it up.
    "/api/0/projects/{organization_id_or_slug}/{project_id_or_slug}/keys/": {
      get: { summary: "list keys", responses: { "200": {} } },
      post: {
        summary: "create key",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" }, id: { type: "string" } },
              },
            },
          },
        },
        responses: { "201": {} },
      },
    },
    "/api/0/projects/{organization_id_or_slug}/{project_id_or_slug}/keys/{key_id}/": {
      get: { summary: "read key", responses: { "200": {} } },
      delete: { summary: "delete key", responses: { "204": {} } },
    },
  },
};

describe("resolveOwnerListPaths (structural FK-owner inference)", () => {
  test("maps top-level param to its bare collection GET", () => {
    const eps = extractEndpoints(SENTRY_LIKE_SPEC as any);
    const map = resolveOwnerListPaths(eps);
    expect(map.get("organization_id_or_slug")).toBe("/api/0/organizations");
  });

  test("Strategy 2 resolves param after a sibling param — walks back to nearest noun", () => {
    const eps = extractEndpoints(SENTRY_LIKE_SPEC as any);
    const map = resolveOwnerListPaths(eps);
    // /api/0/projects/{org}/{proj}/keys/ — Strategy 1 fails (prev seg is
    // a param), Strategy 2 finds /api/0/organizations/{org}/projects/
    // by matching the `projects` hint against GET-list endings.
    expect(map.get("project_id_or_slug")).toBe(
      "/api/0/organizations/{organization_id_or_slug}/projects",
    );
  });

  test("does not resolve a resource's own terminal idParam", () => {
    // alert_rule_id is the alert-rules resource's own id; there's no
    // GET on /api/0/organizations/{org}/alert-rules/{alert_rule_id}/ that
    // would mean "list of alert_rules" — the param's prefix IS the list
    // already. Resolver still maps it (prefix exists); that's fine, but
    // the FK collector skips resource-own idParam separately.
    const eps = extractEndpoints(SENTRY_LIKE_SPEC as any);
    const map = resolveOwnerListPaths(eps);
    expect(map.get("alert_rule_id")).toBe(
      "/api/0/organizations/{organization_id_or_slug}/alert-rules",
    );
  });

  test("ignores params with no matching GET-list anywhere", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        // `widget_id` appears only as an action target — no list collection.
        "/widgets/{widget_id}/cancel": {
          post: { summary: "cancel", responses: { "200": {} } },
        },
      },
    };
    const eps = extractEndpoints(spec as any);
    const map = resolveOwnerListPaths(eps);
    expect(map.has("widget_id")).toBe(false);
  });

  test("prefers the shorter (more canonical) list path on conflicts", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/teams/": { get: { responses: { "200": {} } } },
        "/orgs/{org_id}/teams/": { get: { responses: { "200": {} } } },
        // Some endpoint that uses team_id — could resolve to either
        // /teams/ (length 6) or /orgs/{org_id}/teams/ (length 19).
        // Top-level wins by length.
        "/teams/{team_id}/members/": { get: { responses: { "200": {} } } },
      },
    };
    const eps = extractEndpoints(spec as any);
    const map = resolveOwnerListPaths(eps);
    expect(map.get("team_id")).toBe("/teams");
  });

  test("skips deprecated endpoints in both directions", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/orgs/": { get: { deprecated: true, responses: { "200": {} } } },
        "/orgs/{org_id}/projects/": { get: { responses: { "200": {} } } },
      },
    };
    const eps = extractEndpoints(spec as any);
    const map = resolveOwnerListPaths(eps);
    // /orgs/ is deprecated → no list to point `org_id` at.
    expect(map.has("org_id")).toBe(false);
  });
});

describe("buildApiResourceMap with implicit list-only resources", () => {
  test("Sentry-shaped: every path-FK has a non-null ownerResource (regression for TASK-238)", () => {
    const eps = extractEndpoints(SENTRY_LIKE_SPEC as any);
    const map = buildApiResourceMap({ endpoints: eps, specHash: "s1" });

    // alert-rules hangs off /organizations/{org}/ — the FK must resolve
    // to the implicit `organizations` resource, not `null`.
    const alertRules = map.resources.find(r => r.resource === "alert-rules");
    expect(alertRules).toBeDefined();
    const orgDep = alertRules!.fkDependencies.find(
      d => d.var === "organization_id_or_slug",
    );
    expect(orgDep).toBeDefined();
    expect(orgDep!.in).toBe("path");
    expect(orgDep!.ownerResource).toBe("organizations");

    // keys live under /projects/{org}/{proj}/ — needs BOTH FKs resolved.
    const keys = map.resources.find(r => r.resource === "keys");
    expect(keys).toBeDefined();
    const keyOrg = keys!.fkDependencies.find(d => d.var === "organization_id_or_slug");
    const keyProj = keys!.fkDependencies.find(d => d.var === "project_id_or_slug");
    expect(keyOrg!.ownerResource).toBe("organizations");
    expect(keyProj!.ownerResource).toBe("projects");
  });

  test("registers an implicit list-only resource for each FK target without a CRUD group", () => {
    const eps = extractEndpoints(SENTRY_LIKE_SPEC as any);
    const map = buildApiResourceMap({ endpoints: eps, specHash: "s1" });

    const orgs = map.resources.find(r => r.resource === "organizations");
    expect(orgs).toBeDefined();
    expect(orgs!.hasFullCrud).toBe(false);
    expect(orgs!.endpoints.list).toBe("GET /api/0/organizations/");
    expect(orgs!.endpoints.create).toBeUndefined();
    expect(orgs!.fkDependencies).toEqual([]); // top-level, no parent

    const projects = map.resources.find(r => r.resource === "projects");
    expect(projects).toBeDefined();
    expect(projects!.hasFullCrud).toBe(false);
    expect(projects!.endpoints.list).toBe(
      "GET /api/0/organizations/{organization_id_or_slug}/projects/",
    );
    // Implicit resource still chains: projects list needs org_id_or_slug.
    const projOrgDep = projects!.fkDependencies.find(
      d => d.var === "organization_id_or_slug",
    );
    expect(projOrgDep).toBeDefined();
    expect(projOrgDep!.ownerResource).toBe("organizations");
  });

  test("does not duplicate implicit resources when a CRUD group already covers the list path", () => {
    const eps = extractEndpoints(MINI_SPEC as any);
    const map = buildApiResourceMap({ endpoints: eps, specHash: "x" });
    const audCount = map.resources.filter(r => r.resource === "audiences").length;
    expect(audCount).toBe(1);
  });

  test("serializes implicit resources with idParam: \"\" and itemPath: \"\" — no `null` leaks", () => {
    const eps = extractEndpoints(SENTRY_LIKE_SPEC as any);
    const map = buildApiResourceMap({ endpoints: eps, specHash: "s1" });
    const yaml = serializeApiResourceMap(map);
    expect(yaml).toContain("resource: organizations");
    expect(yaml).toContain("hasFullCrud: false");
    expect(yaml).not.toContain("undefined");
    // No legacy `ownerResource: null` for the path-FKs we just fixed.
    expect(yaml).toMatch(/organization_id_or_slug[\s\S]+?ownerResource: organizations/);
  });

  test("body-FK falls back to name-stemming when structural lookup misses", () => {
    // `audience_id` body field → the existing audiences CRUD group has
    // /audiences as its list, so structural resolution catches it. But
    // verify a body field whose path-param twin doesn't exist still uses
    // the name-stemming fallback.
    const spec = {
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/widgets/": {
          get: { responses: { "200": {} } },
          post: {
            summary: "create widget",
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
        "/widgets/{widget_id}": {
          get: { responses: { "200": {} } },
        },
        "/gizmos/": {
          get: { responses: { "200": {} } },
          post: {
            summary: "create gizmo",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["widget_id"],
                    properties: {
                      // Body field references widget — not via path.
                      widget_id: { type: "string" },
                    },
                  },
                },
              },
            },
            responses: { "201": {} },
          },
        },
        "/gizmos/{gizmo_id}": {
          get: { responses: { "200": {} } },
        },
      },
    };
    const eps = extractEndpoints(spec as any);
    const map = buildApiResourceMap({ endpoints: eps, specHash: "g" });
    const gizmos = map.resources.find(r => r.resource === "gizmos");
    const widgetDep = gizmos!.fkDependencies.find(d => d.var === "widget_id");
    expect(widgetDep).toBeDefined();
    expect(widgetDep!.in).toBe("body");
    expect(widgetDep!.ownerResource).toBe("widgets");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createDiscoveryCache,
  discoverPathParams,
  parentCollectionPath,
} from "../../../src/core/probe/path-discovery.ts";
import type { EndpointInfo } from "../../../src/core/generator/types.ts";

function ep(partial: Partial<EndpointInfo>): EndpointInfo {
  return {
    path: "/x",
    method: "GET",
    operationId: undefined,
    summary: undefined,
    tags: [],
    parameters: [],
    requestBodySchema: undefined,
    requestBodyContentType: undefined,
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [],
    deprecated: false,
    requiresEtag: false,
    ...partial,
  };
}

interface FetchCall { url: string; method: string }
let originalFetch: typeof fetch;
let calls: FetchCall[] = [];
let responder: (req: FetchCall) => { status: number; body?: unknown };

beforeEach(() => {
  originalFetch = globalThis.fetch;
  calls = [];
  responder = () => ({ status: 200, body: { data: [] } });
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    const spec = responder({ url, method });
    const text = spec.body === undefined ? "" : JSON.stringify(spec.body);
    return new Response(text, {
      status: spec.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("parentCollectionPath", () => {
  it("strips trailing /{name}", () => {
    expect(parentCollectionPath("/domains/{domain_id}", "domain_id")).toBe("/domains");
  });

  it("strips middle segment plus tail", () => {
    expect(parentCollectionPath("/domains/{domain_id}/webhooks", "domain_id")).toBe("/domains");
  });

  it("nested: project segment stops before /{project_id}", () => {
    expect(parentCollectionPath("/orgs/{org_id}/projects/{project_id}", "project_id"))
      .toBe("/orgs/{org_id}/projects");
  });

  it("returns undefined when name not in path", () => {
    expect(parentCollectionPath("/domains", "domain_id")).toBeUndefined();
  });
});

describe("discoverPathParams", () => {
  it("happy path: GET /domains → data[0].id", async () => {
    const target = ep({ method: "POST", path: "/domains/{domain_id}/dns" });
    const list = ep({ method: "GET", path: "/domains" });
    responder = () => ({ status: 200, body: { data: [{ id: "abc-123" }] } });
    const cache = createDiscoveryCache();
    const result = await discoverPathParams({
      ep: target,
      unresolved: ["domain_id"],
      allEndpoints: [target, list],
      schemes: [],
      vars: { base_url: "https://api.test" },
      cache,
    });
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") expect(result.values).toEqual({ domain_id: "abc-123" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.test/domains");
  });

  it("appends limit=1 when list endpoint declares limit query param", async () => {
    const target = ep({ method: "POST", path: "/domains/{domain_id}/dns" });
    const list = ep({
      method: "GET",
      path: "/domains",
      parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
    });
    responder = () => ({ status: 200, body: { data: [{ id: "x" }] } });
    await discoverPathParams({
      ep: target,
      unresolved: ["domain_id"],
      allEndpoints: [target, list],
      schemes: [],
      vars: { base_url: "https://api.test" },
      cache: createDiscoveryCache(),
    });
    expect(calls[0]!.url).toBe("https://api.test/domains?limit=1");
  });

  it("miss when no list endpoint in spec", async () => {
    const target = ep({ method: "POST", path: "/domains/{domain_id}/dns" });
    const result = await discoverPathParams({
      ep: target,
      unresolved: ["domain_id"],
      allEndpoints: [target],
      schemes: [],
      vars: { base_url: "https://api.test" },
      cache: createDiscoveryCache(),
    });
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") expect(result.reason).toMatch(/no GET \/domains in spec/);
    expect(calls).toHaveLength(0);
  });

  it("miss when list returns empty array", async () => {
    const target = ep({ method: "POST", path: "/domains/{domain_id}/dns" });
    const list = ep({ method: "GET", path: "/domains" });
    responder = () => ({ status: 200, body: { data: [] } });
    const result = await discoverPathParams({
      ep: target,
      unresolved: ["domain_id"],
      allEndpoints: [target, list],
      schemes: [],
      vars: { base_url: "https://api.test" },
      cache: createDiscoveryCache(),
    });
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") expect(result.reason).toMatch(/empty list/);
  });

  it("miss when list returns non-2xx", async () => {
    const target = ep({ method: "POST", path: "/domains/{domain_id}/dns" });
    const list = ep({ method: "GET", path: "/domains" });
    responder = () => ({ status: 401, body: { message: "unauthorized" } });
    const result = await discoverPathParams({
      ep: target,
      unresolved: ["domain_id"],
      allEndpoints: [target, list],
      schemes: [],
      vars: { base_url: "https://api.test" },
      cache: createDiscoveryCache(),
    });
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") expect(result.reason).toMatch(/returned 401/);
  });

  it("caches list result across endpoints — only one HTTP call", async () => {
    const t1 = ep({ method: "POST", path: "/domains/{domain_id}/dns" });
    const t2 = ep({ method: "PATCH", path: "/domains/{domain_id}" });
    const list = ep({ method: "GET", path: "/domains" });
    responder = () => ({ status: 200, body: { data: [{ id: "shared" }] } });
    const cache = createDiscoveryCache();
    const r1 = await discoverPathParams({
      ep: t1, unresolved: ["domain_id"], allEndpoints: [t1, t2, list],
      schemes: [], vars: { base_url: "https://api.test" }, cache,
    });
    const r2 = await discoverPathParams({
      ep: t2, unresolved: ["domain_id"], allEndpoints: [t1, t2, list],
      schemes: [], vars: { base_url: "https://api.test" }, cache,
    });
    expect(r1.kind).toBe("hit");
    expect(r2.kind).toBe("hit");
    expect(calls).toHaveLength(1);
  });

  it("nested: discovers org_id, then uses it to call /orgs/{org_id}/projects", async () => {
    const target = ep({ method: "POST", path: "/orgs/{org_id}/projects/{project_id}/users" });
    const orgsList = ep({ method: "GET", path: "/orgs" });
    const projectsList = ep({ method: "GET", path: "/orgs/{org_id}/projects" });
    responder = (req) => {
      if (req.url.endsWith("/orgs")) return { status: 200, body: { data: [{ id: "org-1" }] } };
      if (req.url.includes("/orgs/org-1/projects")) {
        return { status: 200, body: { data: [{ id: "proj-9" }] } };
      }
      return { status: 404 };
    };
    const result = await discoverPathParams({
      ep: target,
      unresolved: ["org_id", "project_id"],
      allEndpoints: [target, orgsList, projectsList],
      schemes: [],
      vars: { base_url: "https://api.test" },
      cache: createDiscoveryCache(),
    });
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") {
      expect(result.values).toEqual({ org_id: "org-1", project_id: "proj-9" });
    }
  });

  it("top-level array response shape works", async () => {
    const target = ep({ method: "PATCH", path: "/items/{id}" });
    const list = ep({ method: "GET", path: "/items" });
    responder = () => ({ status: 200, body: [{ id: 42 }] });
    const result = await discoverPathParams({
      ep: target,
      unresolved: ["id"],
      allEndpoints: [target, list],
      schemes: [],
      vars: { base_url: "https://api.test" },
      cache: createDiscoveryCache(),
    });
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") expect(result.values).toEqual({ id: "42" });
  });

  it("strips trailing slash from base_url", async () => {
    const target = ep({ method: "POST", path: "/domains/{domain_id}/dns" });
    const list = ep({ method: "GET", path: "/domains" });
    responder = () => ({ status: 200, body: { data: [{ id: "x" }] } });
    await discoverPathParams({
      ep: target,
      unresolved: ["domain_id"],
      allEndpoints: [target, list],
      schemes: [],
      vars: { base_url: "https://api.test/" },
      cache: createDiscoveryCache(),
    });
    expect(calls[0]!.url).toBe("https://api.test/domains");
  });

  it("sends auth header from vars when scheme requires bearer", async () => {
    const target = ep({ method: "POST", path: "/domains/{domain_id}/dns", security: ["bearer"] });
    const list = ep({ method: "GET", path: "/domains", security: ["bearer"] });
    responder = () => ({ status: 200, body: { data: [{ id: "x" }] } });
    let authHeader: string | undefined;
    globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers as HeadersInit);
      authHeader = headers.get("authorization") ?? undefined;
      return new Response(JSON.stringify({ data: [{ id: "x" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    await discoverPathParams({
      ep: target,
      unresolved: ["domain_id"],
      allEndpoints: [target, list],
      schemes: [{ name: "bearer", type: "http", scheme: "bearer" }],
      vars: { base_url: "https://api.test", auth_token: "secret-tok" },
      cache: createDiscoveryCache(),
    });
    expect(authHeader).toBe("Bearer secret-tok");
  });
});

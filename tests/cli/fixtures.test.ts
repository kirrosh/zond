/**
 * ARV-195 — `zond fixtures` umbrella: unit tests on the pure helpers
 * (curl URL extraction + path-template binding) plus integration
 * tests on the CLI flow via a tmp workspace.
 */
import { describe, test, expect } from "bun:test";
import { extractUrlFromCurl, extractFixturesFromPath, resolveReadbackEndpoint } from "../../src/cli/commands/fixtures.ts";
import { computeAmbiguousPathParams } from "../../src/core/generator/suite-generator.ts";
import type { EndpointInfo } from "../../src/core/generator/types.ts";

function getEp(path: string): EndpointInfo {
  const params = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({ name: m[1]!, in: "path" as const, required: true }));
  return {
    path, method: "GET", tags: [], parameters: params as never,
    responseContentTypes: ["application/json"], responses: [{ statusCode: 200, description: "ok" }], security: [],
  };
}

describe("resolveReadbackEndpoint (ARV-424/423)", () => {
  // event_id is ambiguous (used by two collections) → manifest namespaces it to
  // events_event_id / eventids_event_id. Placeholder-matching {events_event_id}
  // finds nothing; resolving via the manifest's affectedEndpoints (raw {event_id}) works.
  const endpoints = [getEp("/events/{event_id}/"), getEp("/eventids/{event_id}/"), getEp("/orgs/{org_id}/events/{event_id}/")];
  const ambiguous = computeAmbiguousPathParams(endpoints);

  test("ARV-424: namespaced var resolves via manifest affectedEndpoints, not storage-key placeholder", () => {
    const res = resolveReadbackEndpoint(
      "events_event_id", "EV1", ["GET /events/{event_id}/"], endpoints, ambiguous, { base_url: "x" }, "https://api.test",
    );
    expect(res.kind).toBe("url");
    if (res.kind === "url") expect(res.url).toBe("https://api.test/events/EV1/");
  });

  test("ARV-423: an empty sibling path-var is reported, not misattributed to the var under test", () => {
    const res = resolveReadbackEndpoint(
      "events_event_id", "EV1", ["GET /orgs/{org_id}/events/{event_id}/"], endpoints, ambiguous,
      { base_url: "x", org_id: "" }, "https://api.test",
    );
    expect(res.kind).toBe("stale-sibling");
    if (res.kind === "stale-sibling") expect(res.sibling).toBe("org_id");
  });

  test("falls back to spec placeholder search when no manifest affectedEndpoints", () => {
    const res = resolveReadbackEndpoint(
      "event_id", "EV9", undefined, [getEp("/single/{event_id}/")], new Set(), { base_url: "x" }, "https://api.test",
    );
    expect(res.kind).toBe("url");
    if (res.kind === "url") expect(res.url).toBe("https://api.test/single/EV9/");
  });
});

describe("ARV-195 fixtures helpers", () => {
  describe("extractUrlFromCurl", () => {
    test("plain curl with single-quoted URL", () => {
      const c = `curl 'https://api.stripe.com/v1/customers/cus_123'`;
      expect(extractUrlFromCurl(c)).toBe("https://api.stripe.com/v1/customers/cus_123");
    });

    test("Chrome devtools-style curl with escaped newlines + headers", () => {
      const c = `curl 'https://api.example.com/users/42/orders/o-99' \\
  -H 'Authorization: Bearer xxx' \\
  -H 'Accept: application/json' \\
  --compressed`;
      expect(extractUrlFromCurl(c)).toBe("https://api.example.com/users/42/orders/o-99");
    });

    test("returns null when no URL present", () => {
      expect(extractUrlFromCurl(`echo hi`)).toBeNull();
    });

    test("URL embedded after -X METHOD and headers", () => {
      const c = `curl -X POST -H "Content-Type: application/json" "https://api.example.com/v1/charges" -d '{}'`;
      expect(extractUrlFromCurl(c)).toBe("https://api.example.com/v1/charges");
    });
  });

  describe("extractFixturesFromPath", () => {
    const specPaths = [
      "/v1/customers",
      "/v1/customers/{customer_id}",
      "/v1/customers/{customer_id}/sources/{source_id}",
      "/orgs/{org_slug}/projects/{project_slug}/keys",
    ];

    test("matches longest-template-first to avoid greedy short matches", () => {
      const r = extractFixturesFromPath(
        "https://api/v1/customers/cus_123/sources/src_99",
        specPaths,
      );
      expect(r?.matchedTemplate).toBe("/v1/customers/{customer_id}/sources/{source_id}");
      expect(r?.bindings).toEqual({ customer_id: "cus_123", source_id: "src_99" });
    });

    test("multi-level nested slugs", () => {
      const r = extractFixturesFromPath(
        "https://api/orgs/acme/projects/frontend/keys",
        specPaths,
      );
      expect(r?.matchedTemplate).toBe("/orgs/{org_slug}/projects/{project_slug}/keys");
      expect(r?.bindings).toEqual({ org_slug: "acme", project_slug: "frontend" });
    });

    test("returns null when no template fits", () => {
      const r = extractFixturesFromPath("https://api/unrelated/path", specPaths);
      expect(r).toBeNull();
    });

    test("URL-encoded values are decoded into bindings", () => {
      const r = extractFixturesFromPath(
        "https://api/v1/customers/cus%20with%20space",
        specPaths,
      );
      expect(r?.bindings).toEqual({ customer_id: "cus with space" });
    });
  });
});

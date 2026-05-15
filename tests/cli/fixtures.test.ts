/**
 * ARV-195 — `zond fixtures` umbrella: unit tests on the pure helpers
 * (curl URL extraction + path-template binding) plus integration
 * tests on the CLI flow via a tmp workspace.
 */
import { describe, test, expect } from "bun:test";
import { extractUrlFromCurl, extractFixturesFromPath } from "../../src/cli/commands/fixtures.ts";

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

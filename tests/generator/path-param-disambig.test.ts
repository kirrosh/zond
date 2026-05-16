import { describe, test, expect } from "bun:test";
import { disambiguateGenericPathParams } from "../../src/core/generator/path-param-disambig.ts";
import type { EndpointInfo } from "../../src/core/generator/types.ts";

function ep(path: string, paramName = path.match(/\{([^}]+)\}/)?.[1] ?? "id"): EndpointInfo {
  return {
    path,
    method: "GET",
    tags: [],
    parameters: [
      { name: paramName, in: "path", required: true, schema: { type: "string" } } as any,
    ],
    responseContentTypes: ["application/json"],
    responses: [],
    security: [],
    deprecated: false,
    requiresEtag: false,
  };
}

describe("disambiguateGenericPathParams", () => {
  test("renames generic {id} when ≥2 distinct parents collide (ARV-40)", () => {
    const eps = [
      ep("/templates/{id}"),
      ep("/contacts/{id}"),
      ep("/broadcasts/{id}"),
    ];
    disambiguateGenericPathParams(eps);
    expect(eps.map(e => e.path)).toEqual([
      "/templates/{template_id}",
      "/contacts/{contact_id}",
      "/broadcasts/{broadcast_id}",
    ]);
    expect(eps[0]!.parameters[0]!.name).toBe("template_id");
    expect(eps[1]!.parameters[0]!.name).toBe("contact_id");
    expect(eps[2]!.parameters[0]!.name).toBe("broadcast_id");
  });

  test("singularizes plural parent: contact-properties → contact_property_id", () => {
    const eps = [
      ep("/contact-properties/{id}"),
      ep("/topics/{id}"),
    ];
    disambiguateGenericPathParams(eps);
    expect(eps[0]!.path).toBe("/contact-properties/{contact_property_id}");
    expect(eps[1]!.path).toBe("/topics/{topic_id}");
  });

  test("nested item path is also renamed (regression on POST /templates/{id}/publish)", () => {
    const eps = [
      ep("/templates/{id}"),
      ep("/templates/{id}/publish"),
      ep("/contacts/{id}"),
    ];
    disambiguateGenericPathParams(eps);
    expect(eps.map(e => e.path)).toEqual([
      "/templates/{template_id}",
      "/templates/{template_id}/publish",
      "/contacts/{contact_id}",
    ]);
  });

  test("does NOT rename when only one parent uses {id} (no collision → no churn)", () => {
    const eps = [
      ep("/widgets/{id}"),
      ep("/widgets/{id}/details"),
    ];
    disambiguateGenericPathParams(eps);
    expect(eps[0]!.path).toBe("/widgets/{id}");
    expect(eps[0]!.parameters[0]!.name).toBe("id");
  });

  test("leaves already-specific path-params untouched", () => {
    const eps = [
      ep("/emails/{email_id}", "email_id"),
      ep("/domains/{domain_id}", "domain_id"),
    ];
    disambiguateGenericPathParams(eps);
    expect(eps[0]!.path).toBe("/emails/{email_id}");
    expect(eps[1]!.path).toBe("/domains/{domain_id}");
    expect(eps[0]!.parameters[0]!.name).toBe("email_id");
  });

  test("mixed: some generic colliding, some unique-specific", () => {
    const eps = [
      ep("/emails/{email_id}", "email_id"),
      ep("/templates/{id}"),
      ep("/contacts/{id}"),
    ];
    disambiguateGenericPathParams(eps);
    expect(eps[0]!.path).toBe("/emails/{email_id}");
    expect(eps[1]!.path).toBe("/templates/{template_id}");
    expect(eps[2]!.path).toBe("/contacts/{contact_id}");
  });

  test("generic {slug} collides too — same rule applies", () => {
    const eps = [
      ep("/articles/{slug}", "slug"),
      ep("/pages/{slug}", "slug"),
    ];
    disambiguateGenericPathParams(eps);
    expect(eps[0]!.path).toBe("/articles/{article_slug}");
    expect(eps[1]!.path).toBe("/pages/{page_slug}");
  });
});

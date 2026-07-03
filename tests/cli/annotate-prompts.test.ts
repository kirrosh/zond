/**
 * ARV-271: buildResourceSlices must resolve $ref parameters so that
 * downstream inferrers (idempotency / pagination) see the real param
 * name. Stripe-style specs declare `Idempotency-Key` once under
 * `components.headers` (or `components.parameters`) and reference it
 * from every POST operation via `$ref`.
 */

import { describe, test, expect } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";
import { buildResourceSlices } from "../../src/cli/commands/api/annotate/prompts.ts";
import { inferIdempotency } from "../../src/cli/commands/api/annotate/auto.ts";
import type { ResourceYaml } from "../../src/cli/commands/discover.ts";

function resourceMap(): ResourceYaml[] {
  return [
    {
      resource: "things",
      basePath: "/v1/things",
      itemPath: "/v1/things/{id}",
      endpoints: { create: "POST /v1/things" },
    } as ResourceYaml,
  ];
}

describe("buildResourceSlices param $ref resolution", () => {
  test("resolves $ref to components.parameters", () => {
    const doc: OpenAPIV3.Document = {
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/v1/things": {
          post: {
            parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
      components: {
        parameters: {
          IdempotencyKey: {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { type: "string" },
          },
        },
      },
    };
    const [slice] = buildResourceSlices(doc, resourceMap());
    const params = slice!.endpoints.create!.parameters!;
    expect(params).toHaveLength(1);
    expect(params[0]!.name).toBe("Idempotency-Key");
    expect(params[0]!.in).toBe("header");

    const inf = inferIdempotency(slice!);
    expect(inf).not.toBeNull();
    expect(inf!.patch.idempotency?.header).toBe("Idempotency-Key");
  });

  test("resolves $ref to components.headers (Stripe-style)", () => {
    const doc: OpenAPIV3.Document = {
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/v1/things": {
          post: {
            parameters: [{ $ref: "#/components/headers/Idempotency-Key" }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
      components: {
        headers: {
          "Idempotency-Key": {
            description: "Stripe idempotency key",
            schema: { type: "string" },
          },
        },
      },
    };
    const [slice] = buildResourceSlices(doc, resourceMap());
    const params = slice!.endpoints.create!.parameters!;
    expect(params).toHaveLength(1);
    expect(params[0]!.name).toBe("Idempotency-Key");
    expect(params[0]!.in).toBe("header");

    const inf = inferIdempotency(slice!);
    expect(inf).not.toBeNull();
  });

  test("unresolvable $ref is skipped silently", () => {
    const doc: OpenAPIV3.Document = {
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/v1/things": {
          post: {
            parameters: [{ $ref: "#/components/parameters/Missing" }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const [slice] = buildResourceSlices(doc, resourceMap());
    expect(slice!.endpoints.create!.parameters).toBeUndefined();
  });
});

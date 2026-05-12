import { describe, expect, test } from "bun:test";
import { buildCreateRequestBody } from "../../src/core/generator/create-body.ts";
import type { OpenAPIV3 } from "openapi-types";

describe("buildCreateRequestBody (ARV-47)", () => {
  test("substitutes FK fields with knownFixtures values", () => {
    const schema: OpenAPIV3.SchemaObject = {
      type: "object",
      required: ["audience_id", "name"],
      properties: {
        audience_id: { type: "string", format: "uuid" },
        name: { type: "string" },
      },
    };
    const body = buildCreateRequestBody(schema, {
      knownFixtures: { audience_id: "aud_real_42", base_url: "https://x" },
    }) as Record<string, unknown>;
    expect(body.audience_id).toBe("aud_real_42");
    // non-FK fields keep generator output (template tokens are fine — runner resolves them)
    expect(typeof body.name).toBe("string");
  });

  test("walks nested objects + arrays", () => {
    const schema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: {
        owner: {
          type: "object",
          properties: {
            user_id: { type: "string" },
            email: { type: "string", format: "email" },
          },
        },
        tags: {
          type: "array",
          items: { type: "object", properties: { tag_id: { type: "string" } } },
        },
      },
    };
    const body = buildCreateRequestBody(schema, {
      knownFixtures: { user_id: "usr_99", tag_id: "tag_7" },
    }) as { owner: { user_id: string }; tags: Array<{ tag_id: string }> };
    expect(body.owner.user_id).toBe("usr_99");
    expect(body.tags[0]!.tag_id).toBe("tag_7");
  });

  test("FK field without a known value keeps generator placeholder", () => {
    const schema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: { audience_id: { type: "string" } },
    };
    const body = buildCreateRequestBody(schema, { knownFixtures: {} }) as Record<string, unknown>;
    expect(typeof body.audience_id).toBe("string");
    // Either {{$uuid}} or some random-string placeholder — both acceptable;
    // important: NOT undefined and NOT a literal "aud_real_..." we never set.
    expect(body.audience_id).not.toBe("");
  });

  test("camelCase Id suffix counts as FK", () => {
    const schema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: { audienceId: { type: "string" } },
    };
    const body = buildCreateRequestBody(schema, {
      knownFixtures: { audienceId: "aud_real_42" },
    }) as Record<string, unknown>;
    expect(body.audienceId).toBe("aud_real_42");
  });

  test("non-FK fields named *_id are substituted only if FK-shaped suffix", () => {
    // `bid` is not FK-shaped (just ends in 'id', no underscore). Real APIs
    // sometimes have fields like `valid` — those must not be substituted.
    const schema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: {
        valid: { type: "boolean" },
        contact_id: { type: "string" },
      },
    };
    const body = buildCreateRequestBody(schema, {
      knownFixtures: { valid: "WRONG", contact_id: "ct_7" },
    }) as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect(body.contact_id).toBe("ct_7");
  });
});

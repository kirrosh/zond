/**
 * Build a request body for a POST/create endpoint that can actually pass
 * the API's validators on a live target.
 *
 * `generateFromSchema` is purely schema-driven: it emits `{{$uuid}}` for
 * `audience_id`-shaped fields, so when `prepare-fixtures --seed` POSTs a
 * generated body the API replies 422 ("audience aud_xyz not found") and
 * the seed loop quits with no progress (F1-14 in feedback-round 14).
 *
 * `buildCreateRequestBody` wraps `generateFromSchema` and walks the
 * resulting object: any property name that looks like a foreign-key id
 * (`*_id` / `*Id` / `*_uuid`) AND has a real value in `knownFixtures`
 * (typically loaded from `.env.yaml` plus values captured earlier in the
 * same cascade pass) gets that real value substituted in. Random
 * placeholders only survive when no env value exists.
 *
 * Used by `prepare-fixtures --seed --apply` (former `bootstrap`) so each
 * cascade step that POSTs a child resource pulls its parent ids from
 * what discover already filled. Without this, every nested resource is
 * a guaranteed 422.
 */

import type { OpenAPIV3 } from "openapi-types";
import { generateFromSchema } from "./data-factory.ts";
import { canonicalVarName } from "./fixtures-builder.ts";

const FK_FIELD_RE = /(?:_id|Id|_uuid)$/;

function substituteFkFields(value: unknown, knownFixtures: Record<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map(v => substituteFkFields(v, knownFixtures));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      // Recurse first — nested objects may carry their own FKs.
      const recursed = substituteFkFields(v, knownFixtures);
      if (FK_FIELD_RE.test(k)) {
        // ARV-138: look up by raw field name first (back-compat with envs
        // that still key off `issueId`), then by canonical snake_case form
        // (`issue_id`) — which is the only form the manifest emits since
        // ARV-138. This keeps both old `.env.yaml`s and new ones working
        // during the rollout window.
        const fixture = knownFixtures[k] ?? knownFixtures[canonicalVarName(k)];
        if (typeof fixture === "string" && fixture.length > 0) {
          out[k] = fixture;
          continue;
        }
      }
      out[k] = recursed;
    }
    return out;
  }
  return value;
}

export interface BuildCreateRequestBodyOptions {
  /**
   * Real values from `.env.yaml` (and prior cascade captures) keyed by
   * variable name. When a body field's name matches a key here AND the
   * field looks FK-shaped, that value replaces the schema-derived random
   * placeholder.
   */
  knownFixtures?: Record<string, string>;
}

/**
 * Spec-aware body builder for live-API seed POSTs. Returns a JSON-shaped
 * object ready to `JSON.stringify` and send.
 *
 *  - Schema → object via `generateFromSchema(forRequest: true)`. This
 *    already strips `readOnly` and bare `id` fields the server assigns.
 *  - Walks the result and swaps FK-shaped fields for `knownFixtures`
 *    values when present.
 *
 *  Tokens like `{{$randomEmail}}` / `{{$uuid}}` produced by the schema
 *  layer are intentionally left in place — the live runner resolves them
 *  via `substituteDeep` right before the request is sent.
 */
export function buildCreateRequestBody(
  schema: OpenAPIV3.SchemaObject,
  options: BuildCreateRequestBodyOptions = {},
): unknown {
  const generated = generateFromSchema(schema, undefined, { forRequest: true });
  const known = options.knownFixtures ?? {};
  if (Object.keys(known).length === 0) return generated;
  return substituteFkFields(generated, known);
}

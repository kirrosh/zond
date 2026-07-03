import type { OpenAPIV3 } from "openapi-types";

/**
 * Recursively generates test data from an OpenAPI schema.
 * Uses heuristic placeholders ({{$...}} generators) where possible.
 *
 * `forRequest` (default true) toggles request-body filters that strip
 * server-assigned fields the client must not send: properties marked
 * `readOnly: true`, and the literal field name `id` at any object level
 * (universally server-assigned in REST). Pass `forRequest: false` to
 * preserve full schema shape for response-side fixtures.
 */
export function generateFromSchema(
  schema: OpenAPIV3.SchemaObject,
  propertyName?: string,
  opts: { _depth?: number; forRequest?: boolean } = {},
): unknown {
  const _depth = opts._depth ?? 0;
  const forRequest = opts.forRequest ?? true;
  const recurse = (s: OpenAPIV3.SchemaObject, name?: string) =>
    generateFromSchema(s, name, { _depth: _depth + 1, forRequest });

  if (_depth > 7) {
    return depthLimitDefault(schema, propertyName);
  }

  // Highest-priority signal: explicit example from spec.
  // Beats enum, format, heuristics — the spec author told us what to send.
  // Two exceptions:
  //   1. `null` examples are noise (often nullable: true with no real example) —
  //      skip so we fall through to type/format defaults instead of emitting null.
  //   2. UUID-shaped examples on FK-context fields (name ends with `_id` or
  //      schema.format === "uuid") are usually copy-pasted from another tenant's
  //      spec. Honoring them leaks foreign IDs and guarantees 422 on real APIs;
  //      `{{$uuid}}` is at least an honest test placeholder.
  //
  // OpenAPI 3.1 / JSON Schema also allows `examples: [...]` (plural array). When
  // both are present `example` wins; otherwise pick the first non-null entry
  // from `examples` and apply the same FK-UUID guard. `example` (singular) is
  // still the OpenAPI 3.0 form and remains supported.
  const exampleValue = pickExampleValue(schema);
  if (exampleValue !== undefined) {
    if (!isLikelyForeignFKExample(schema, propertyName, exampleValue)) {
      return exampleValue;
    }
  }

  // allOf: merge all schemas
  if (schema.allOf) {
    const merged: OpenAPIV3.SchemaObject = { type: "object", properties: {} };
    for (const sub of schema.allOf) {
      const s = sub as OpenAPIV3.SchemaObject;
      if (s.properties) {
        merged.properties = { ...merged.properties, ...s.properties };
      }
    }
    return recurse(merged, propertyName);
  }

  // oneOf / anyOf: pick the most informative variant. Prefer objects with
  // properties over loose primitives — APIs that accept `Array<{id}>|Array<string>`
  // need the object variant, not a string that 422s. Falls back to first
  // non-null entry.
  //
  // ARV-78 (feedback round-04 / F25): when the parent schema declares a
  // `discriminator: { propertyName, mapping? }` (typical OpenAPI 3 polymorphism —
  // /automations.steps with type=trigger|action), pick the variant whose
  // discriminator property carries a const/enum-single value and stamp that
  // value into the result. Without this, generator emits a random variant and
  // the API 422s with "Missing <required-by-other-variant>".
  if (schema.oneOf) {
    const variants = schema.oneOf as OpenAPIV3.SchemaObject[];
    const picked = pickBestVariant(variants, schema.discriminator);
    const result = recurse(picked, propertyName);
    return stampDiscriminator(result, picked, schema.discriminator);
  }
  if (schema.anyOf) {
    const variants = schema.anyOf as OpenAPIV3.SchemaObject[];
    const picked = pickBestVariant(variants, schema.discriminator);
    const result = recurse(picked, propertyName);
    return stampDiscriminator(result, picked, schema.discriminator);
  }

  // enum: first value (always valid for the API contract)
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }

  // Format-based placeholders override type resolution. Schemas in the wild
  // commonly carry `format` without an explicit `type` (loosely-defined specs)
  // or with `type: ["string", "null"]` (OpenAPI 3.1 nullable). Falling through
  // to the type switch in those cases dropped us into the default branch and
  // produced `{{$randomString}}` for `format: email` — TASK-86 regression.
  const formatPlaceholder = formatToPlaceholder(schema.format);
  if (formatPlaceholder !== undefined) return formatPlaceholder;

  // OpenAPI 3.1: type can be `["string", "null"]`. Collapse to the first
  // non-null entry so the switch below routes correctly.
  let effectiveType = Array.isArray(schema.type)
    ? (schema.type as string[]).find(t => t !== "null") as OpenAPIV3.SchemaObject["type"] | undefined
    : schema.type;

  // ARV-67 (feedback round-01 / F7): schemas in the wild routinely omit
  // `type` on nested-object fields and rely on `properties` / `required`
  // / `items` to convey shape. Without the salvage below, the default
  // branch returns "{{$randomString}}" for a missing-type field — which
  // is what made `prepare-fixtures --seed` send a string for nested
  // objects like `automations.config` / `automations.steps` and earn
  // "Expected object, received string" 422s. Infer the type
  // from structural hints when nothing else gives one.
  if (effectiveType === undefined) {
    if ((schema as { items?: unknown }).items !== undefined) effectiveType = "array";
    else if (schema.properties || Array.isArray(schema.required)) effectiveType = "object";
  }

  switch (effectiveType) {
    case "string":
      return guessStringPlaceholder(schema, propertyName);

    case "integer":
      return guessIntPlaceholder(propertyName, schema);

    case "number":
      return 29.99;

    case "boolean":
      return true;

    case "array": {
      const arr = schema as OpenAPIV3.ArraySchemaObject;
      if (arr.items) {
        const item = recurse(arr.items as OpenAPIV3.SchemaObject, undefined);
        return [item];
      }
      return [];
    }

    case "object":
    default: {
      // Treat unknown type with properties as object
      if (schema.properties) {
        const obj: Record<string, unknown> = {};
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          const ps = propSchema as OpenAPIV3.SchemaObject;
          if (forRequest && shouldSkipForRequest(key, ps)) continue;
          obj[key] = recurse(ps, key);
        }
        return obj;
      }
      // Record type (additionalProperties only). The historical behavior was
      // to materialize fake `key1`/`key2` entries to make the shape visible.
      // Real APIs reject those — the keys are always domain-specific
      // (filter names, label keys). Emit an empty `{}` instead: it preserves
      // the object type (so type-validators pass) without injecting payloads
      // the server didn't ask for. Callers who need realistic record content
      // should override via fixture-pack/.env.yaml.
      if (
        (schema.additionalProperties && typeof schema.additionalProperties === "object") ||
        schema.additionalProperties === true
      ) {
        return {};
      }
      // Bare object with no properties
      if (effectiveType === "object") {
        return {};
      }
      return "{{$randomString}}";
    }
  }
}

/** Fields the client must not send in a request body: explicit `readOnly: true`,
 *  or the literal name `id`. The latter is a heuristic for under-specified specs
 *  (common in in-house APIs) that don't mark the server-assigned id readOnly
 *  but still 4xx on it being present.
 *
 *  Also strips Stripe-style `expand` meta-param when it's declared as a string
 *  array — Stripe doesn't mark it `readOnly` but rejects synthetic random
 *  values with 400 "This property cannot be expanded (<random>)", which kills
 *  50+ baseline POSTs in mass-assignment / stateful checks on Stripe specs.
 *  The shape check (array of strings on a request body) keeps false-positives
 *  low: APIs using `expand` for real payload fields would normally use an
 *  object/enum, not a free-string array. */
function shouldSkipForRequest(name: string, schema: OpenAPIV3.SchemaObject): boolean {
  if (schema.readOnly === true) return true;
  if (name === "id") return true;
  if (name === "expand" && isStringArray(schema)) return true;
  return false;
}

function isStringArray(schema: OpenAPIV3.SchemaObject): boolean {
  if (schema.type !== "array") return false;
  const items = schema.items as OpenAPIV3.SchemaObject | undefined;
  if (!items) return false;
  return items.type === "string";
}

/** When recursion hits the depth cap, return a type-appropriate placeholder
 *  rather than `{}` — `{}` for `array<string>` produces `[{}]` which 422s on
 *  every realistic API. */
function depthLimitDefault(schema: OpenAPIV3.SchemaObject, name?: string): unknown {
  const t = Array.isArray(schema.type)
    ? (schema.type as string[]).find(x => x !== "null")
    : schema.type;
  switch (t) {
    case "string": return formatToPlaceholder(schema.format) ?? guessStringPlaceholder(schema, name);
    case "integer": return 1;
    case "number": return 1;
    case "boolean": return true;
    case "array": return [];
    case "object":
    default: return {};
  }
}

/** ARV-135 (m-21): score-based oneOf/anyOf variant selection.
 *
 * Picks the variant most likely to produce a body the server accepts:
 *
 *   1. Drop `type: "null"` shorthands unless they're the only choice
 *      (OpenAPI 3.1 nullable spelling).
 *   2. Prefer the variant with the fewest UNRESOLVABLE required fields
 *      — i.e. required keys that have no entry in `properties`, which
 *      the generator can't synthesise. The historical bug was picking
 *      the FIRST variant matching the discriminator filter even when a
 *      sibling variant was demonstrably more complete; this leaves
 *      `required: [config, event_name]` partially-filled and the API
 *      422s with "Missing config, event_name" (F24/Resend automations).
 *   3. Among ties, prefer object-typed variants over primitives
 *      (TASK-222: `Array<{id}>|Array<string>` should pick the object).
 *   4. Prefer the variant with more declared properties (richer surface
 *      is closer to what real callers send).
 *   5. When a `discriminator.propertyName` is present, treat variants
 *      that carry a single-value enum/const for that property as more
 *      authoritative — they tie-break ahead of variants without one.
 *
 * The discriminator's `mapping` is used to derive the stamped value
 * even when the picked variant lacks an inline enum/const: typical
 * specs (Stripe, Linear) declare mapping centrally and omit the value
 * on each variant.
 */
function pickBestVariant(
  variants: OpenAPIV3.SchemaObject[],
  discriminator: OpenAPIV3.DiscriminatorObject | undefined,
): OpenAPIV3.SchemaObject {
  const isNull = (s: OpenAPIV3.SchemaObject) => (s as { type?: unknown }).type === "null";
  const nonNull = variants.filter(v => !isNull(v));
  const pool = nonNull.length > 0 ? nonNull : variants;

  const discriminatorKey = discriminator?.propertyName;
  const hasDiscriminatorEnum = (v: OpenAPIV3.SchemaObject): boolean => {
    if (!discriminatorKey) return false;
    const prop = v.properties?.[discriminatorKey] as OpenAPIV3.SchemaObject | undefined;
    if (!prop) return false;
    const en = (prop as { enum?: unknown[] }).enum;
    const cn = (prop as { const?: unknown }).const;
    return (Array.isArray(en) && en.length === 1) || (cn !== undefined && cn !== null);
  };

  const score = (v: OpenAPIV3.SchemaObject) => {
    const req = (v.required ?? []) as string[];
    const props = v.properties ?? {};
    const unresolvable = req.filter(r => !(r in props)).length;
    const propCount = Object.keys(props).length;
    const isObjectWithProps = v.type === "object" && propCount > 0;
    return {
      unresolvable,
      hasDiscriminator: hasDiscriminatorEnum(v) ? 1 : 0,
      isObjectWithProps: isObjectWithProps ? 1 : 0,
      propCount,
    };
  };

  // Sort: fewer unresolvable → has discriminator → object-with-props → more props.
  // Sort is stable, so original spec order breaks remaining ties.
  const ranked = [...pool].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa.unresolvable !== sb.unresolvable) return sa.unresolvable - sb.unresolvable;
    if (sa.hasDiscriminator !== sb.hasDiscriminator) return sb.hasDiscriminator - sa.hasDiscriminator;
    if (sa.isObjectWithProps !== sb.isObjectWithProps) return sb.isObjectWithProps - sa.isObjectWithProps;
    return sb.propCount - sa.propCount;
  });

  return ranked[0]!;
}

/** Stamp the discriminator key onto a generated object. Without this the
 *  variant choice is "anonymous" from the body's point of view — APIs that
 *  switch on `type` reject the request even when every other field is
 *  perfect.
 *
 *  ARV-135: now also honours `discriminator.mapping` — when the picked
 *  variant has no inline enum/const for the discriminator property, fall
 *  back to the first mapping key. Specs that declare polymorphism via
 *  central mapping (rather than inline `enum: ["x"]` on each variant)
 *  previously left the body un-stamped. */
function stampDiscriminator(
  result: unknown,
  variant: OpenAPIV3.SchemaObject,
  discriminator: OpenAPIV3.DiscriminatorObject | undefined,
): unknown {
  const propertyName = discriminator?.propertyName;
  if (!propertyName) return result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  let stamp: unknown;
  const prop = variant.properties?.[propertyName] as OpenAPIV3.SchemaObject | undefined;
  if (prop) {
    const en = (prop as { enum?: unknown[] }).enum;
    const cn = (prop as { const?: unknown }).const;
    if (Array.isArray(en) && en.length === 1) stamp = en[0];
    else if (cn !== undefined && cn !== null) stamp = cn;
  }
  if (stamp === undefined && discriminator?.mapping) {
    const keys = Object.keys(discriminator.mapping);
    if (keys.length > 0) stamp = keys[0];
  }
  if (stamp === undefined) return result;
  (result as Record<string, unknown>)[propertyName] = stamp;
  return result;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Names that strongly imply an email field. Kept in sync with the email
 *  branch of `guessStringPlaceholder`/`classifyFieldSource`. Used to gate the
 *  description-based domain heuristic so phrases like "verified sending
 *  domain" in the description of a `from`/`to` field don't override the
 *  email mapping. */
function isEmailContextName(name?: string): boolean {
  if (!name) return false;
  // Canonical snake_case so camelCase (`replyTo`, `userEmail`) matches the
  // same rules as `reply_to` / `user_email`.
  const lower = canonicalVarName(name);
  return (
    lower === "email" ||
    lower === "from" ||
    lower === "to" ||
    lower === "cc" ||
    lower === "bcc" ||
    lower === "sender" ||
    lower === "recipient" ||
    lower === "reply_to" ||
    lower.endsWith("_email") ||
    lower.endsWith("_reply_to") ||
    lower.endsWith("_from") ||
    lower.endsWith("_to") ||
    lower.endsWith("_cc") ||
    lower.endsWith("_bcc")
  );
}

/** A schema `pattern` that explicitly allows lowercase but not uppercase
 *  letters (typical slug regex like `^[a-z0-9_\-]+$`). Used to switch from
 *  mixed-case `{{$randomString}}` to a slug-shaped generator. */
function isLowercaseOnlyPattern(pattern: string | undefined): boolean {
  if (!pattern) return false;
  return pattern.includes("a-z") && !pattern.includes("A-Z");
}

/** A string example shaped like a UUID, on a field that looks like a foreign
 *  key (name ends with `_id` or schema declares `format: uuid`), is almost
 *  always a tenant-specific value the spec author left in `example:`. Sending
 *  it verbatim guarantees 422 on a fresh account and leaks foreign IDs. */
function isLikelyForeignFKExample(
  schema: OpenAPIV3.SchemaObject,
  name?: string,
  value?: unknown,
): boolean {
  const ex = value !== undefined ? value : schema.example;
  if (typeof ex !== "string") return false;
  if (!UUID_RE.test(ex)) return false;
  const fkByName = !!name && name.toLowerCase().endsWith("_id");
  const fkByFormat = schema.format === "uuid";
  return fkByName || fkByFormat;
}

/** Resolve the effective example value from a schema, supporting both
 *  OpenAPI 3.0 `example` (singular) and OpenAPI 3.1 / JSON Schema `examples`
 *  (plural array). `example` wins when both are set — it's the more
 *  intentional, single-source signal. `null` is treated as "no example"
 *  (see TASK-221). For `examples`, we pick the first non-null entry. */
function pickExampleValue(schema: OpenAPIV3.SchemaObject): unknown {
  if (schema.example !== undefined && schema.example !== null) {
    return schema.example;
  }
  const examples = (schema as { examples?: unknown }).examples;
  if (Array.isArray(examples)) {
    for (const ex of examples) {
      if (ex !== null && ex !== undefined) return ex;
    }
  }
  return undefined;
}

/**
 * TASK-269 — per-field provenance for `zond generate --explain`.
 *
 * Returns a label describing *why* `generateFromSchema` would emit the
 * value it does for a given (schema, propertyName). Mirrors the dispatch
 * priority in `generateFromSchema` without producing the value, so
 * `--explain` can show "name → {{$randomName}} [heuristic:name]" without
 * re-executing generation.
 *
 * Kept as a parallel function instead of refactoring `generateFromSchema`
 * to record sources — the recursion path-tracking complexity would
 * outweigh the value for what is currently a debug-only surface. The
 * heuristic order here MUST stay in lockstep with the function above; a
 * unit test (data-factory.test.ts) pins the labels for each branch.
 */
export type FieldSource =
  | "example"
  | "examples"
  | "enum"
  | "format"
  | "pattern"
  | "min"
  | "max"
  | "random"
  | "default"
  | `heuristic:${string}`;

export function classifyFieldSource(
  schema: OpenAPIV3.SchemaObject,
  propertyName?: string,
): FieldSource {
  // example > examples (3.1) — same FK-UUID guard as generateFromSchema.
  if (schema.example !== undefined && schema.example !== null) {
    if (!isLikelyForeignFKExample(schema, propertyName, schema.example)) {
      return "example";
    }
  }
  const examples = (schema as { examples?: unknown }).examples;
  if (Array.isArray(examples)) {
    for (const ex of examples) {
      if (ex === null || ex === undefined) continue;
      if (!isLikelyForeignFKExample(schema, propertyName, ex)) return "examples";
      break;
    }
  }
  if (schema.enum && schema.enum.length > 0) return "enum";
  if (formatToPlaceholder(schema.format) !== undefined) return "format";

  const t = Array.isArray(schema.type)
    ? (schema.type as string[]).find(x => x !== "null")
    : schema.type;

  if (t === "string") {
    // ARV-38: keep --explain in sync with guessStringPlaceholder — when a
    // default is consumed, label the source as "default", not "random".
    if (typeof schema.default === "string" && schema.default.length > 0) return "default";
    if (isLowercaseOnlyPattern(schema.pattern)) return "pattern";
    if (
      schema.description &&
      /\b(domain|hostname|fqdn)\b/i.test(schema.description) &&
      !isEmailContextName(propertyName)
    ) {
      return "heuristic:domain-from-description";
    }
    if (propertyName) {
      const lower = canonicalVarName(propertyName);
      if (lower === "slug" || lower.endsWith("_slug")) return "heuristic:slug";
      if (lower === "domain" || lower === "hostname" || lower === "fqdn" || lower.endsWith("_domain")) return "heuristic:domain";
      if (lower === "platform") return "heuristic:platform";
      if (lower === "language" || lower === "lang" || lower === "locale") return "heuristic:locale";
      if (lower === "country" || lower === "country_code" || lower.endsWith("_country") || lower.endsWith("_country_code")) return "heuristic:country";
      if (lower === "timezone" || lower === "time_zone" || lower === "tz") return "heuristic:timezone";
      if (lower === "currency" || lower === "currency_code" || lower.endsWith("_currency") || lower.endsWith("_currency_code")) return "heuristic:currency";
      if (lower === "mcc" || lower.endsWith("_mcc") || lower === "merchant_category_code") return "heuristic:mcc";
      if (lower === "color" || lower.endsWith("_color") || lower === "background_color" || lower === "hex" || lower.endsWith("_hex_color")) return "heuristic:color";
      if (lower === "ip" || lower === "ip_address" || lower.endsWith("_ip") || lower.endsWith("_ip_address")) return "heuristic:ip";
      if (
        lower === "email" || lower === "from" || lower === "to" || lower === "cc" ||
        lower === "bcc" || lower === "sender" || lower === "recipient" ||
        lower === "reply_to" ||
        lower.endsWith("_email") ||
        lower.endsWith("_reply_to") || lower.endsWith("_from") ||
        lower.endsWith("_to") || lower.endsWith("_cc") || lower.endsWith("_bcc")
      ) return "heuristic:email";
      if (lower === "id" || lower === "uuid" || lower.endsWith("_id") || lower.endsWith("id")) return "heuristic:id";
      if (lower === "name" || lower.endsWith("_name")) return "heuristic:name";
      if (lower === "url" || lower.endsWith("_url") || lower === "uri" || lower === "href" || lower === "website") return "heuristic:url";
      if (lower === "password" || lower.endsWith("_password")) return "heuristic:password";
      if (lower === "phone" || lower === "telephone" || lower.endsWith("_phone")) return "heuristic:phone";
    }
    return "random";
  }

  if (t === "integer") {
    if (schema.maximum !== undefined) return "max";
    if (schema.minimum !== undefined && schema.minimum > 0) return "min";
    return "random";
  }

  if (t === "number" || t === "boolean") return "default";
  return "default";
}

/**
 * ARV-138: canonicalise a body field name to a manifest/fixture var name.
 * Converts camelCase → snake_case + lowercase so spec body fields
 * (`issueId`, `sequenceTypeCode`) collapse onto the same var as the
 * path-param spelling. Idempotent on already-snake_case input. The HTTP
 * request still sends the raw field name — only the {{var}} namespace is
 * normalised. Lives here (leaf module) so both fixtures-builder and
 * suite-generator can share it without an import cycle.
 */
export function canonicalVarName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();
}

const FK_ID_SUFFIX = /(?:_id|Id|_uuid)$/;
const CODE_REF_SUFFIX = /(?:_code|Code)$/;

/**
 * ARV-45: a required request-body field that is a foreign-key / closed-
 * vocabulary reference the generator can't synthesise a valid value for —
 * so the generated test should reference a `{{fixture}}` the user fills in
 * `.env.yaml`, not random junk that 400s and kills the CRUD chain at step 1.
 *
 *  - `*_id` / `*Id` / `*_uuid`: always an FK. `generateFromSchema` emits
 *    `{{$uuid}}` here — a random id that 404/422s on a live API.
 *  - `*_code` / `*Code`: a reference code ONLY when no heuristic resolves
 *    it. `countryCode`/`currencyCode`/`mcc`… already map to real literals
 *    via `guessStringPlaceholder`, so they're excluded; the domain codes
 *    that motivated this (`sequenceTypeCode`, `templateGroupCode`) fall
 *    through to `{{$randomString}}` → 400.
 *
 * Enum/format/example-backed fields are never FK fixtures — the spec
 * already told us a valid value.
 */
export function isFkFixtureField(name: string, schema: OpenAPIV3.SchemaObject): boolean {
  if (schema.enum && schema.enum.length > 0) return false;
  if (pickExampleValue(schema) !== undefined) return false;
  if (FK_ID_SUFFIX.test(name)) return true;
  if (CODE_REF_SUFFIX.test(name)) {
    return generateFromSchema(schema, name) === "{{$randomString}}";
  }
  return false;
}

/**
 * Flatten a request-body schema to its effective `{properties, required}`,
 * merging `allOf` branches. .NET / Swagger-gen specs wrap almost every model
 * in `allOf: [{...}]` (inheritance), so a direct `schema.properties` read sees
 * nothing — `generateFromSchema` already merges allOf when producing the body,
 * and FK wiring / the manifest must resolve the same shape or they silently
 * miss every FK field on these specs. Recurses through nested allOf; ignores
 * oneOf/anyOf (the generator picks one variant there, out of scope for FK
 * wiring until a real spec needs it).
 */
export function effectiveObjectShape(
  schema: OpenAPIV3.SchemaObject,
): { properties: Record<string, OpenAPIV3.SchemaObject>; required: Set<string> } {
  const properties: Record<string, OpenAPIV3.SchemaObject> = {};
  const required = new Set<string>();
  const visit = (s: OpenAPIV3.SchemaObject | undefined) => {
    if (!s || typeof s !== "object") return;
    if (Array.isArray(s.allOf)) {
      for (const sub of s.allOf) visit(sub as OpenAPIV3.SchemaObject);
    }
    if (s.properties) {
      for (const [k, v] of Object.entries(s.properties)) {
        properties[k] = v as OpenAPIV3.SchemaObject;
      }
    }
    if (Array.isArray(s.required)) for (const r of s.required) required.add(r);
  };
  visit(schema);
  return { properties, required };
}

/**
 * Map an OpenAPI `format` value to a zond generator placeholder. Returns
 * undefined when the format is unknown or absent so callers can fall back
 * to type / property-name heuristics. Exported for tests.
 */
export function formatToPlaceholder(format: string | undefined): string | undefined {
  switch (format) {
    case "email": return "{{$randomEmail}}";
    case "uuid": return "{{$uuid}}";
    case "date-time": return "{{$randomIsoDate}}";
    case "date": return "{{$randomDate}}";
    case "uri":
    case "url": return "{{$randomUrl}}";
    case "hostname": return "{{$randomFqdn}}";
    case "ipv4": return "{{$randomIpv4}}";
    case "ipv6": return "::1";
    case "password": return "TestPass123!";
    // ARV-165: format-aware helpers. None of these are standard OpenAPI 3.x
    // formats, but Stripe/GitHub/Shopify/Twilio specs frequently carry them
    // as ad-hoc `format:` tags. Falling through to {{$randomString}} guarantees
    // 400 from format-validated APIs (R09 finding: 199 hit-but-fail Stripe steps).
    case "iso-country-code":
    case "country-code":
    case "country": return "{{$randomCountryCode}}";
    case "iso-currency-code":
    case "currency-code":
    case "currency": return "{{$randomCurrencyCode}}";
    case "mcc": return "{{$randomMCC}}";
    case "color":
    case "hex-color":
    case "rgb-hex": return "{{$randomColorHex}}";
    default: return undefined;
  }
}

/**
 * Generate a multipart body object from an OpenAPI multipart/form-data schema.
 * Binary fields (format: binary/byte) become file upload objects; all others become strings.
 */
export function generateMultipartFromSchema(
  schema: OpenAPIV3.SchemaObject,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (!schema.properties) return result;

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const s = propSchema as OpenAPIV3.SchemaObject;
    if (shouldSkipForRequest(key, s)) continue;
    if (s.format === "binary" || s.format === "byte") {
      result[key] = { file: `./fixtures/${key}.bin`, content_type: "application/octet-stream" };
    } else {
      const val = generateFromSchema(s, key);
      result[key] = val;
    }
  }

  return result;
}

function guessStringPlaceholder(schema: OpenAPIV3.SchemaObject, name?: string): string {
  // Format-based dispatch already happened earlier in generateFromSchema;
  // this branch only sees strings whose format is empty or unrecognised.

  // ARV-38: when the spec declares a JSON-Schema `default` for a string-typed
  // field with no enum, prefer it over heuristics. PATCH endpoints in
  // particular rely on this — e.g. a `PATCH /domains/{id}` with
  // `tls: { type: string, default: "opportunistic" }` would otherwise get
  // a random fallback and a guaranteed 422 every run.
  if (typeof schema.default === "string" && schema.default.length > 0) {
    return schema.default;
  }

  // Pattern-aware: many specs constrain slugs via regex like
  // `^(?![0-9]+$)[a-z0-9_\-]+$` without setting `format`. Default
  // `{{$randomString}}` mixes upper+lower → 400 from the validator.
  // Heuristic: pattern allows `a-z` but forbids `A-Z` → emit a slug.
  if (isLowercaseOnlyPattern(schema.pattern)) {
    return "{{$randomSlug}}";
  }

  // Description-aware: when the schema describes a domain/hostname (e.g.
  // a `POST /domains/`-style endpoint or DNS-zone create route) but the
  // field is generically named `name`, the default `{{$randomName}}`
  // returns "Bob Wilson" and the server rejects it. TASK-224.
  // Skip when the field name is clearly in email vocabulary — email-API
  // specs often describe `from`/`to`/etc. with phrases like "verified
  // sending domain" or "Name <user@domain>", which trips the regex but
  // the field is an email, not a domain. Email vocab > domain-from-description.
  if (
    schema.description &&
    /\b(domain|hostname|fqdn)\b/i.test(schema.description) &&
    !isEmailContextName(name)
  ) {
    return "{{$randomDomain}}";
  }

  // Name-based heuristics. Match on the canonical snake_case form so
  // camelCase fields (`countryCode`, `firstName`, `userEmail`) hit the same
  // rules as their snake_case spelling — otherwise they fall through to
  // {{$randomString}} and 400 on closed-vocab/format-strict APIs.
  if (name) {
    const lower = canonicalVarName(name);
    if (lower === "slug" || lower.endsWith("_slug")) {
      return "{{$randomSlug}}";
    }
    if (lower === "domain" || lower === "hostname" || lower === "fqdn" || lower.endsWith("_domain")) {
      return "{{$randomDomain}}";
    }
    // Closed-vocabulary fields where servers validate against an internal
    // dictionary even when the spec lacks `enum:`. Random strings → 400.
    // Pick the most universally-accepted value per dictionary.
    if (lower === "platform") return "python";
    if (lower === "language" || lower === "lang" || lower === "locale") return "en";
    // ARV-165: country/currency literals (US/USD) were universally accepted
    // but offered zero variety — added endsWith() patterns so nested fields
    // like `bank_account.country`, `payout.currency_code`, `from_country`
    // also resolve. Still emit a literal — picking from the random helper
    // would weaken the "always-valid" property for downstream assertions
    // that pin on the first value.
    if (lower === "country" || lower === "country_code" || lower.endsWith("_country") || lower.endsWith("_country_code")) return "US";
    if (lower === "timezone" || lower === "time_zone" || lower === "tz") return "UTC";
    if (lower === "currency" || lower === "currency_code" || lower.endsWith("_currency") || lower.endsWith("_currency_code")) return "USD";
    // ARV-165: MCC (merchant category code) — Stripe/Square/issuing APIs.
    // Random {{$randomString}} → 400 because it's not a 4-digit code.
    if (lower === "mcc" || lower.endsWith("_mcc") || lower === "merchant_category_code") return "{{$randomMCC}}";
    // ARV-165: hex color — Stripe brand settings, Slack themes, GitHub labels.
    if (lower === "color" || lower.endsWith("_color") || lower === "background_color" || lower === "hex" || lower.endsWith("_hex_color")) return "{{$randomColorHex}}";
    // ARV-165: IP addresses — Stripe tos_acceptance.ip, audit logs, fraud APIs.
    if (lower === "ip" || lower === "ip_address" || lower.endsWith("_ip") || lower.endsWith("_ip_address")) return "{{$randomIpv4}}";
    // Email-context fields. Email-API specs often
    // omit `format: email` on `from`/`to`/`reply_to`/`cc`/`bcc` — the field
    // name is the only clue, and `{{$randomString}}` guarantees a 422.
    if (
      lower === "email" ||
      lower === "from" ||
      lower === "to" ||
      lower === "cc" ||
      lower === "bcc" ||
      lower === "sender" ||
      lower === "recipient" ||
      lower === "reply_to" ||
      lower.endsWith("_email") ||
      lower.endsWith("_reply_to") ||
      lower.endsWith("_from") ||
      lower.endsWith("_to") ||
      lower.endsWith("_cc") ||
      lower.endsWith("_bcc")
    ) {
      return "{{$randomEmail}}";
    }
    if (lower === "id" || lower === "uuid" || lower.endsWith("_id") || lower.endsWith("id")) {
      return "{{$uuid}}";
    }
    if (lower === "name" || lower.endsWith("_name")) {
      return "{{$randomName}}";
    }
    if (lower === "url" || lower.endsWith("_url") || lower === "uri" || lower === "href" || lower === "website") {
      return "{{$randomUrl}}";
    }
    if (lower === "password" || lower.endsWith("_password")) {
      return "TestPass123!";
    }
    if (lower === "phone" || lower === "telephone" || lower.endsWith("_phone")) {
      return "+1234567890";
    }
  }

  return "{{$randomString}}";
}

function guessIntPlaceholder(name?: string, schema?: OpenAPIV3.SchemaObject): number | string {
  const min = schema?.minimum;
  const max = schema?.maximum;
  if (max !== undefined) {
    // Use a safe concrete value within the declared range
    const lo = min !== undefined && min > 0 ? min : 1;
    return Math.min(lo, max);
  }
  if (min !== undefined && min > 0) {
    return min;
  }
  return "{{$randomInt}}";
}

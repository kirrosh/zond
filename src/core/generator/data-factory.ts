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
    const picked = pickDiscriminatorVariant(variants, schema.discriminator?.propertyName)
      ?? pickPreferredVariant(variants);
    const result = recurse(picked, propertyName);
    return stampDiscriminator(result, picked, schema.discriminator?.propertyName);
  }
  if (schema.anyOf) {
    const variants = schema.anyOf as OpenAPIV3.SchemaObject[];
    const picked = pickDiscriminatorVariant(variants, schema.discriminator?.propertyName)
      ?? pickPreferredVariant(variants);
    const result = recurse(picked, propertyName);
    return stampDiscriminator(result, picked, schema.discriminator?.propertyName);
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
 *  but still 4xx on it being present. */
function shouldSkipForRequest(name: string, schema: OpenAPIV3.SchemaObject): boolean {
  if (schema.readOnly === true) return true;
  if (name === "id") return true;
  return false;
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

/** ARV-78 (F25): when a parent oneOf/anyOf carries `discriminator.propertyName`,
 *  pick the variant whose discriminator property has a single-value enum or
 *  const so its identity is unambiguous. Returns undefined when nothing
 *  qualifies — caller falls back to pickPreferredVariant. */
function pickDiscriminatorVariant(
  variants: OpenAPIV3.SchemaObject[],
  propertyName: string | undefined,
): OpenAPIV3.SchemaObject | undefined {
  if (!propertyName) return undefined;
  for (const v of variants) {
    const prop = v.properties?.[propertyName] as OpenAPIV3.SchemaObject | undefined;
    if (!prop) continue;
    const en = (prop as { enum?: unknown[] }).enum;
    const cn = (prop as { const?: unknown }).const;
    if (Array.isArray(en) && en.length === 1) return v;
    if (cn !== undefined && cn !== null) return v;
  }
  return undefined;
}

/** Stamp the discriminator key onto a generated object. Without this the
 *  variant choice is "anonymous" from the body's point of view — APIs that
 *  switch on `type` reject the request even when every other field is
 *  perfect. No-op when the propertyName is missing or the variant lacks an
 *  enum/const for that property. */
function stampDiscriminator(
  result: unknown,
  variant: OpenAPIV3.SchemaObject,
  propertyName: string | undefined,
): unknown {
  if (!propertyName) return result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const prop = variant.properties?.[propertyName] as OpenAPIV3.SchemaObject | undefined;
  if (!prop) return result;
  const en = (prop as { enum?: unknown[] }).enum;
  const cn = (prop as { const?: unknown }).const;
  let stamp: unknown;
  if (Array.isArray(en) && en.length === 1) stamp = en[0];
  else if (cn !== undefined && cn !== null) stamp = cn;
  else return result;
  (result as Record<string, unknown>)[propertyName] = stamp;
  return result;
}

/** Prefer the most data-shape-informative variant from a oneOf/anyOf list:
 *  object-with-properties > non-null > first. Skips `type: "null"` entries
 *  introduced by 3.1 nullable shorthand. */
function pickPreferredVariant(variants: OpenAPIV3.SchemaObject[]): OpenAPIV3.SchemaObject {
  const isNull = (s: OpenAPIV3.SchemaObject) =>
    (s as { type?: unknown }).type === "null";
  const nonNull = variants.filter(v => !isNull(v));
  const pool = nonNull.length > 0 ? nonNull : variants;

  const objectWithProps = pool.find(
    v => v.type === "object" && v.properties && Object.keys(v.properties).length > 0,
  );
  if (objectWithProps) return objectWithProps;

  return pool[0]!;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Names that strongly imply an email field. Kept in sync with the email
 *  branch of `guessStringPlaceholder`/`classifyFieldSource`. Used to gate the
 *  description-based domain heuristic so phrases like "verified sending
 *  domain" in the description of a `from`/`to` field don't override the
 *  email mapping. */
function isEmailContextName(name?: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return (
    lower === "email" ||
    lower === "from" ||
    lower === "to" ||
    lower === "cc" ||
    lower === "bcc" ||
    lower === "sender" ||
    lower === "recipient" ||
    lower === "reply_to" ||
    lower === "replyto" ||
    lower.endsWith("_email") ||
    lower.endsWith("Email") ||
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
      const lower = propertyName.toLowerCase();
      if (lower === "slug" || lower.endsWith("_slug")) return "heuristic:slug";
      if (lower === "domain" || lower === "hostname" || lower === "fqdn" || lower.endsWith("_domain")) return "heuristic:domain";
      if (lower === "platform") return "heuristic:platform";
      if (lower === "language" || lower === "lang" || lower === "locale") return "heuristic:locale";
      if (lower === "country" || lower === "country_code") return "heuristic:country";
      if (lower === "timezone" || lower === "time_zone" || lower === "tz") return "heuristic:timezone";
      if (lower === "currency" || lower === "currency_code") return "heuristic:currency";
      if (
        lower === "email" || lower === "from" || lower === "to" || lower === "cc" ||
        lower === "bcc" || lower === "sender" || lower === "recipient" ||
        lower === "reply_to" || lower === "replyto" ||
        lower.endsWith("_email") || lower.endsWith("Email") ||
        lower.endsWith("_reply_to") || lower.endsWith("_from") ||
        lower.endsWith("_to") || lower.endsWith("_cc") || lower.endsWith("_bcc")
      ) return "heuristic:email";
      if (lower === "id" || lower === "uuid" || lower.endsWith("_id") || lower.endsWith("id")) return "heuristic:id";
      if (lower === "name" || lower.endsWith("_name") || lower.endsWith("Name")) return "heuristic:name";
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

  // Name-based heuristics
  if (name) {
    const lower = name.toLowerCase();
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
    if (lower === "country" || lower === "country_code") return "US";
    if (lower === "timezone" || lower === "time_zone" || lower === "tz") return "UTC";
    if (lower === "currency" || lower === "currency_code") return "USD";
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
      lower === "replyto" ||
      lower.endsWith("_email") ||
      lower.endsWith("Email") ||
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
    if (lower === "name" || lower.endsWith("_name") || lower.endsWith("Name")) {
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

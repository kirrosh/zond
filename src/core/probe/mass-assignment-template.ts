/**
 * TASK-146: emit-template generator.
 *
 * Builds a ready-to-edit YAML probe template for a single endpoint, so the
 * user doesn't have to copy-paste the boilerplate from the skill (Phase 5.1).
 * Used when the auto-prober marked an endpoint INCONCLUSIVE / INCONCLUSIVE-5XX
 * and the user wants to drop down to manual catch-up.
 *
 * Heuristics:
 *  - Suspected fields: classic mass-assignment vectors (is_admin, role,
 *    owner_id, account_id, ...).
 *  - readOnly: true / x-zond-protected fields lifted from the request body
 *    schema — these MUST NOT round-trip back from the server.
 *  - For POST endpoints with discoverable item path (GET-by-id / DELETE
 *    counterpart) we emit a full create → verify → cleanup chain.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo } from "../generator/types.ts";
import type { RawSuite, RawStep } from "../generator/serializer.ts";
import { serializeSuite } from "../generator/serializer.ts";
import { readOpenApiSpec, extractEndpoints } from "../generator/openapi-reader.ts";
import { findDeleteCounterpart, findGetByIdCounterpart, captureFieldFor } from "./shared.ts";
import { SUSPECTED_FIELDS } from "./mass-assignment-probe.ts";

export interface EmitTemplateOptions {
  specPath: string;
  method: string;
  path: string;
}

export type EmitTemplateResult =
  | { kind: "ok"; yaml: string; chain: "full" | "single"; protectedFields: string[] }
  | { kind: "endpoint-not-found"; method: string; path: string; nearest: string[] };

export async function buildMassAssignmentTemplate(
  opts: EmitTemplateOptions,
): Promise<EmitTemplateResult> {
  const doc = await readOpenApiSpec(opts.specPath);
  const all = extractEndpoints(doc);

  const wantMethod = opts.method.toUpperCase();
  const target = all.find(
    e => e.method.toUpperCase() === wantMethod && pathsEqual(e.path, opts.path),
  );

  if (!target) {
    const nearest = all
      .filter(e => e.method.toUpperCase() === wantMethod)
      .map(e => e.path)
      .filter(p => similar(p, opts.path))
      .slice(0, 5);
    return { kind: "endpoint-not-found", method: wantMethod, path: opts.path, nearest };
  }

  const protectedFields = collectProtectedFields(target.requestBodySchema);
  const baselineBody = buildBaselineSkeleton(target.requestBodySchema);
  const privilegedBody = mergePrivileged(baselineBody, protectedFields);

  const isMutatingCreateLike = wantMethod === "POST";
  const readSibling = isMutatingCreateLike ? findGetByIdCounterpart(target, all) : undefined;
  const deleteSibling = findDeleteCounterpart(target, all);

  const suite = isMutatingCreateLike && readSibling
    ? buildFullChain(target, readSibling, deleteSibling, privilegedBody, protectedFields)
    : buildSingleStep(target, privilegedBody, protectedFields);

  return {
    kind: "ok",
    yaml: serializeSuite(suite),
    chain: isMutatingCreateLike && readSibling ? "full" : "single",
    protectedFields,
  };
}

function collectProtectedFields(schema?: OpenAPIV3.SchemaObject): string[] {
  if (!schema || !schema.properties) return [];
  const out: string[] = [];
  for (const [name, raw] of Object.entries(schema.properties)) {
    const prop = raw as OpenAPIV3.SchemaObject & { "x-zond-protected"?: boolean };
    if (prop.readOnly === true || prop["x-zond-protected"] === true) out.push(name);
  }
  return out;
}

function buildBaselineSkeleton(schema?: OpenAPIV3.SchemaObject): Record<string, unknown> {
  // Skeleton is intentionally minimal — `# …real create body sourced from
  // fixtures…` placeholder shows up in the YAML so the user fills it in.
  if (!schema || !schema.properties) return {};
  const out: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(schema.properties)) {
    const prop = raw as OpenAPIV3.SchemaObject;
    if (prop.readOnly === true) continue;
    if (schema.required?.includes(name)) {
      out[name] = placeholderForType(prop);
    }
  }
  return out;
}

function placeholderForType(prop: OpenAPIV3.SchemaObject): unknown {
  if (prop.example !== undefined) return prop.example;
  switch (prop.type) {
    case "integer":
    case "number": return 1;
    case "boolean": return false;
    case "array": return [];
    case "object": return {};
    default: return `ma-test-{{$randomString}}`;
  }
}

function mergePrivileged(
  baseline: Record<string, unknown>,
  protectedFields: string[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...baseline };
  // Suspected fields always added.
  for (const [k, v] of Object.entries(SUSPECTED_FIELDS)) merged[k] = v;
  // readOnly / x-zond-protected fields: inject distinctive sentinel values
  // so we can detect server-side echo vs server-side regeneration.
  for (const f of protectedFields) {
    if (!(f in merged)) merged[f] = `attacker-${f}-{{$uuid}}`;
  }
  return merged;
}

/** ARV-198: declared content type signals whether the create step needs
 *  `form:` (Stripe v1, Rails/PHP-style APIs) or the default `json:` body. */
function isFormEndpoint(ep: EndpointInfo): boolean {
  return ep.requestBodyContentType === "application/x-www-form-urlencoded";
}

function buildFullChain(
  create: EndpointInfo,
  read: EndpointInfo,
  del: EndpointInfo | undefined,
  privilegedBody: Record<string, unknown>,
  protectedFields: string[],
): RawSuite {
  const idVar = captureFieldFor(create) || "created_id";
  const tests: RawStep[] = [];

  // ARV-198: when the spec declares only application/x-www-form-urlencoded
  // for this mutating endpoint, emit a `form:` block + Content-Type header.
  // The serializer force-quotes form values (ARV-162) so booleans/numbers
  // round-trip as strings on the wire; the template is paste-ready against
  // Stripe-style APIs without any post-processing.
  const createIsForm = isFormEndpoint(create);
  const createStep: Record<string, unknown> = {
    name: "create with privileged fields",
    [create.method.toUpperCase()]: create.path,
    expect: { status: [200, 201], body: { id: { capture: idVar } } },
  };
  if (createIsForm) {
    createStep.headers = { "Content-Type": "application/x-www-form-urlencoded" };
    createStep.form = privilegedBody;
  } else {
    createStep.json = privilegedBody;
  }
  tests.push(createStep as unknown as RawStep);

  // Canonical assertion vocabulary: only `not_equals` is supported (no `not`,
  // no `not_starts_with`). For protected fields we assert the exact attacker
  // sentinel value did NOT round-trip back from the server.
  const verifyBody: Record<string, Record<string, unknown>> = {};
  for (const k of Object.keys(SUSPECTED_FIELDS)) {
    verifyBody[k] = { not_equals: SUSPECTED_FIELDS[k] };
  }
  for (const f of protectedFields) {
    if (!(f in verifyBody)) verifyBody[f] = { not_contains: "attacker-" };
  }

  tests.push({
    name: "verify privileged fields not echoed",
    [read.method.toUpperCase()]: read.path.replace(/\{[^}]+\}/, `{{${idVar}}}`),
    expect: { status: 200, body: verifyBody as unknown as Record<string, Record<string, string>> },
  } as unknown as RawStep);

  if (del) {
    tests.push({
      name: "cleanup",
      [del.method.toUpperCase()]: del.path.replace(/\{[^}]+\}/, `{{${idVar}}}`),
      always: true,
      expect: { status: [200, 202, 204] },
    } as unknown as RawStep);
  }

  return {
    name: `ma ${slugFromPath(create.path)}`,
    base_url: "{{base_url}}",
    headers: { Authorization: "Bearer {{auth_token}}" },
    tests,
  };
}

function buildSingleStep(
  ep: EndpointInfo,
  privilegedBody: Record<string, unknown>,
  _protectedFields: string[],
): RawSuite {
  const method = ep.method.toUpperCase();
  const tests: RawStep[] = [];
  const step: Record<string, unknown> = {
    name: `mass-assignment ${method} ${ep.path}`,
    [method]: ep.path,
    expect: { status: [400, 422] },
  };
  if (method !== "GET" && method !== "DELETE") {
    // ARV-198: same form/json branching as the full-chain create — see
    // buildFullChain for rationale (Stripe-style mutators declare only
    // application/x-www-form-urlencoded).
    if (isFormEndpoint(ep)) {
      step.headers = { "Content-Type": "application/x-www-form-urlencoded" };
      step.form = privilegedBody;
    } else {
      step.json = privilegedBody;
    }
  }
  tests.push(step as unknown as RawStep);
  return {
    name: `ma ${slugFromPath(ep.path)}`,
    base_url: "{{base_url}}",
    headers: { Authorization: "Bearer {{auth_token}}" },
    tests,
  };
}

function pathsEqual(a: string, b: string): boolean {
  return a.replace(/\/$/, "") === b.replace(/\/$/, "");
}

function similar(a: string, b: string): boolean {
  const aSeg = a.split("/").filter(Boolean);
  const bSeg = b.split("/").filter(Boolean);
  return aSeg.some(s => bSeg.includes(s));
}

function slugFromPath(p: string): string {
  return p.replace(/^\//, "").replace(/\/?\{[^}]+\}/g, "").replace(/\//g, "-") || "endpoint";
}

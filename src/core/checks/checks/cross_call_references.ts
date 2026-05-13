/**
 * `cross_call_references` (m-20 ARV-169) — POST→GET shape-diff probe.
 *
 * For each CRUD group with create+read, POST a generated body, capture
 * the new id from the response, then GET the resource and diff the
 * write-shape against the read-shape. Fields the create accepted (or
 * echoed) but the read didn't return surface as drift findings — the
 * server is silently dropping state.
 *
 * Severity policy:
 *   • `state_not_persisted` (POST echoed, GET dropped) is the high-
 *     signal class, so the check is registered as HIGH.
 *   • `write_only` (POST accepted, GET never returned) is also surfaced
 *     in the same finding's evidence. Anti-FP: write-only fields the
 *     spec explicitly declares are *not* present on GET (e.g. password
 *     write-only properties) are filtered out via spec.responses.GET
 *     declared field set.
 *   • Per-resource quirks (Stripe `metadata` stripping, livemode) are
 *     declared in `.api-resources[.local].yaml` `readback_diff` blocks
 *     and the harness threads them through `resourceConfigs`.
 *
 * The check fails (one finding) when EITHER list is non-empty. The
 * evidence carries the per-field breakdown so the reporter can show
 * exactly which fields drifted and how. We deliberately emit a single
 * finding per resource — splitting into one-finding-per-field would
 * inflate counts but tell the user the same story.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { CrudStatefulCheck } from "../stateful.ts";
import { generateFromSchema } from "../../generator/data-factory.ts";
import { extractIdFromCreateResponse, fillPathWithId, fillPathParams, serializeCheckBody } from "./_crud-helpers.ts";
import { computeDrift } from "./_readback-helpers.ts";

function declaredReadFields(read: { responses: Array<{ statusCode: number; schema?: unknown }> }): Set<string> {
  const success = read.responses.find((r) => r.statusCode >= 200 && r.statusCode < 300);
  const schema = success?.schema as OpenAPIV3.SchemaObject | undefined;
  if (!schema?.properties) return new Set();
  return new Set(Object.keys(schema.properties));
}

function safeParse(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export const crossCallReferences: CrudStatefulCheck = {
  id: "cross_call_references",
  severity: "high",
  defaultExpected: "Fields accepted or echoed by POST must be readable via GET on the same resource",
  references: [{ id: "ARV-169" }, { id: "OWASP-API-3-2023" }],
  phase: "crud",
  applies(g) {
    return Boolean(g.create && g.read);
  },
  async run(g, h) {
    if (h.bootstrapCleanupFailed) {
      return { kind: "skip", reason: "bootstrap-cleanup failed — stateful checks paused" };
    }
    const create = g.create!;
    const read = g.read!;
    const baseHeaders = { Accept: "application/json", ...h.authHeaders };

    if (!create.requestBodySchema) {
      return { kind: "skip", reason: "create has no requestBody schema — nothing to diff" };
    }
    const writeBody = generateFromSchema(create.requestBodySchema);
    if (writeBody == null || typeof writeBody !== "object") {
      return { kind: "skip", reason: "generated create body is not an object" };
    }

    const createUrl = `${h.baseUrl.replace(/\/+$/, "")}${fillPathParams(create.path, h.pathVars)}`;
    // ARV-191: form-urlencoded dispatch — see _crud-helpers.serializeCheckBody.
    const { body: createBodyStr, contentType } = serializeCheckBody(create, writeBody as Record<string, unknown>, h.pathVars);
    const createResp = await h.send({
      method: "POST",
      url: createUrl,
      headers: { ...baseHeaders, "Content-Type": contentType },
      body: createBodyStr,
    });
    if (createResp.status < 200 || createResp.status >= 300) {
      return { kind: "skip", reason: `create returned ${createResp.status} — broken-baseline guard` };
    }
    const echo = createResp.body_parsed ?? safeParse(createResp.body);
    const id = extractIdFromCreateResponse(echo, g.idParam);
    if (id == null) return { kind: "skip", reason: "could not extract id from create response" };

    // Substitute parent-scope vars first (e.g., {organization_id_or_slug}),
    // then the captured id for {idParam}. Order matters: fillPathWithId's
    // fallback regex replaces ANY remaining `{...}` with the id, so parent
    // vars must already be resolved when it runs.
    const readPath = fillPathWithId(fillPathParams(read.path, h.pathVars), g.idParam, id);
    const readUrl = `${h.baseUrl.replace(/\/+$/, "")}${readPath}`;
    const readResp = await h.send({ method: "GET", url: readUrl, headers: baseHeaders });
    if (readResp.status < 200 || readResp.status >= 300) {
      return { kind: "skip", reason: `read returned ${readResp.status} — broken-baseline guard` };
    }
    const readBody = readResp.body_parsed ?? safeParse(readResp.body);

    const cfg = h.resourceConfigs?.get(g.resource)?.readbackDiff;
    const specDeclared = declaredReadFields(read);
    const drift = computeDrift(writeBody, echo, readBody, specDeclared, cfg);

    const stateNotPersisted = drift.stateNotPersisted;
    const writeOnly = drift.writeOnly;
    if (stateNotPersisted.length === 0 && writeOnly.length === 0) {
      return { kind: "pass" };
    }

    const driftedFields = [
      ...stateNotPersisted.map((d) => d.field),
      ...writeOnly.map((d) => d.field),
    ];
    return {
      kind: "fail",
      message:
        stateNotPersisted.length > 0
          ? `POST→GET drift on ${g.resource}: ${stateNotPersisted.length} state-not-persisted field(s)` +
            (writeOnly.length > 0 ? `, ${writeOnly.length} write-only field(s)` : "")
          : `POST→GET drift on ${g.resource}: ${writeOnly.length} write-only field(s)`,
      evidence: {
        resource: g.resource,
        id,
        state_not_persisted: stateNotPersisted.map((d) => ({ field: d.field, written_value: d.writtenValue })),
        write_only: writeOnly.map((d) => d.field),
        drifted_fields: driftedFields,
      },
    };
  },
};

/**
 * `ensure_resource_availability` (m-15 ARV-3) — create a resource via
 * POST, then GET by id; the read must succeed (2xx). Catches lost-
 * write bugs where the create returns 201 but the resource never
 * actually appears in storage.
 */
import type { CrudStatefulCheck } from "../stateful.ts";
import { generateFromSchema } from "../../generator/data-factory.ts";
import { extractIdFromCreateResponse, fillPathWithId } from "./_crud-helpers.ts";

export const ensureResourceAvailability: CrudStatefulCheck = {
  id: "ensure_resource_availability",
  severity: "medium",
  defaultExpected: "GET on a freshly-created resource must succeed (2xx)",
  references: [{ id: "CWE-924" }],
  phase: "crud",
  applies(g) {
    return Boolean(g.create && g.read);
  },
  async run(g, h) {
    if (h.bootstrapCleanupFailed) {
      return { kind: "skip", reason: "bootstrap-cleanup failed — security checks paused (ARV-3 AC #6)" };
    }
    const create = g.create!;
    const read = g.read!;
    const baseHeaders = { Accept: "application/json", ...h.authHeaders };
    const body = create.requestBodySchema
      ? JSON.stringify(generateFromSchema(create.requestBodySchema))
      : "{}";
    const createResp = await h.send({
      method: "POST",
      url: `${h.baseUrl.replace(/\/+$/, "")}${create.path}`,
      headers: { ...baseHeaders, "Content-Type": create.requestBodyContentType ?? "application/json" },
      body,
    });
    if (createResp.status < 200 || createResp.status >= 300) {
      return { kind: "skip", reason: `create returned ${createResp.status} — broken-baseline guard` };
    }
    const id = extractIdFromCreateResponse(createResp.body_parsed ?? createResp.body, g.idParam);
    if (id == null) return { kind: "skip", reason: "could not extract id from create response" };

    const readResp = await h.send({
      method: "GET",
      url: `${h.baseUrl.replace(/\/+$/, "")}${fillPathWithId(read.path, g.idParam, id)}`,
      headers: baseHeaders,
    });
    if (readResp.status >= 200 && readResp.status < 300) return { kind: "pass" };
    return {
      kind: "fail",
      message: `GET on freshly-created resource ${id} returned ${readResp.status}`,
      evidence: { resource: g.resource, id, create_status: createResp.status, read_status: readResp.status },
    };
  },
};

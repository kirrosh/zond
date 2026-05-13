/**
 * `use_after_free` (m-15 ARV-3) — given a CRUD group with create+read+
 * delete, create a resource, delete it, then GET by id. The server
 * must respond 404/410. Any 2xx means the resource is still readable
 * after a successful DELETE (a classic data-leak / soft-delete bug).
 */
import type { CrudStatefulCheck } from "../stateful.ts";
import { generateFromSchema } from "../../generator/data-factory.ts";
import { extractIdFromCreateResponse, fillPathWithId, fillPathParams } from "./_crud-helpers.ts";

export const useAfterFree: CrudStatefulCheck = {
  id: "use_after_free",
  severity: "high",
  defaultExpected: "GET on a deleted resource must return 404 or 410",
  references: [{ id: "CWE-672" }],
  phase: "crud",
  applies(g) {
    return Boolean(g.create && g.read && g.delete);
  },
  async run(g, h) {
    if (h.bootstrapCleanupFailed) {
      return { kind: "skip", reason: "bootstrap-cleanup failed — security checks paused (ARV-3 AC #6)" };
    }
    const create = g.create!;
    const read = g.read!;
    const del = g.delete!;
    const baseHeaders = { Accept: "application/json", ...h.authHeaders };

    // 1. create
    const createBody = create.requestBodySchema
      ? JSON.stringify(generateFromSchema(create.requestBodySchema))
      : "{}";
    const createUrl = `${h.baseUrl.replace(/\/+$/, "")}${fillPathParams(create.path, h.pathVars)}`;
    const createResp = await h.send({
      method: "POST",
      url: createUrl,
      headers: { ...baseHeaders, "Content-Type": create.requestBodyContentType ?? "application/json" },
      body: createBody,
    });
    if (createResp.status < 200 || createResp.status >= 300) {
      return { kind: "skip", reason: `create returned ${createResp.status} — broken-baseline guard` };
    }
    const id = extractIdFromCreateResponse(createResp.body_parsed ?? createResp.body, g.idParam);
    if (id == null) return { kind: "skip", reason: "could not extract id from create response" };

    // 2. delete
    const delResp = await h.send({
      method: "DELETE",
      url: `${h.baseUrl.replace(/\/+$/, "")}${fillPathWithId(fillPathParams(del.path, h.pathVars), g.idParam, id)}`,
      headers: baseHeaders,
    });
    if (delResp.status < 200 || delResp.status >= 300) {
      return { kind: "skip", reason: `delete returned ${delResp.status} — broken-baseline guard` };
    }

    // 3. read after delete
    const readResp = await h.send({
      method: "GET",
      url: `${h.baseUrl.replace(/\/+$/, "")}${fillPathWithId(fillPathParams(read.path, h.pathVars), g.idParam, id)}`,
      headers: baseHeaders,
    });
    if (readResp.status === 404 || readResp.status === 410) return { kind: "pass" };
    if (readResp.status >= 200 && readResp.status < 300) {
      return {
        kind: "fail",
        message: `GET on resource ${id} after DELETE returned ${readResp.status} — resource still readable`,
        evidence: { resource: g.resource, id, get_status_after_delete: readResp.status },
      };
    }
    return { kind: "skip", reason: `read after delete returned ${readResp.status} — neither 404/410 nor 2xx` };
  },
};

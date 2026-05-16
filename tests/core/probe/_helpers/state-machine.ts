import type { OpenAPIV3 } from "openapi-types";
import { postEp as ep } from "../../../_helpers/endpoints";

export interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

export type Responder = (req: FetchCall) => { status: number; body?: unknown };

export interface MockResourceOptions {
  /** Initial state of the resource. Mutated by accepted PUTs. */
  initial: Record<string, unknown>;
  /** When true, PUTs containing more than one writable key are rejected with 422
   *  (Sentry-style partial-PUT API). The first multi-key PUT is still counted
   *  in the returned `multiKeyPutCount`. */
  partialPutOnly?: boolean;
  /** When set, PUTs after the Nth one return `breakStatus` (default 500) so
   *  callers can simulate a downstream outage during restore. */
  breakAfter?: number;
  breakStatus?: number;
}

export interface MockResourceHandle {
  responder: Responder;
  /** Live state — read after the probe runs to assert restore worked. */
  current: Record<string, unknown>;
  /** Number of PUT requests carrying more than one key. Useful for asserting
   *  that the probe never fans out a wide body except for the discovery shot. */
  multiKeyPutCount: () => number;
  /** Total successful PUTs (status 200). */
  acceptedPutCount: () => number;
  /** GET / DELETE counters. */
  getCount: () => number;
  deleteCount: () => number;
}

/**
 * Build a stateful responder for tests that probe PUT/GET resource pairs.
 * Centralises the "if GET … if PUT … if DELETE …" closure that was duplicated
 * across security-probe tests.
 */
export function mockResource(opts: MockResourceOptions): MockResourceHandle {
  const handle: MockResourceHandle = {
    responder: () => ({ status: 200 }),
    current: { ...opts.initial },
    multiKeyPutCount: () => multiKey,
    acceptedPutCount: () => accepted,
    getCount: () => gets,
    deleteCount: () => deletes,
  };
  let multiKey = 0;
  let accepted = 0;
  let putCalls = 0;
  let gets = 0;
  let deletes = 0;
  const breakAfter = opts.breakAfter;
  const breakStatus = opts.breakStatus ?? 500;

  handle.responder = (req) => {
    if (req.method === "GET") {
      gets++;
      return { status: 200, body: { ...handle.current } };
    }
    if (req.method === "PUT") {
      putCalls++;
      if (breakAfter !== undefined && putCalls > breakAfter) {
        return { status: breakStatus, body: { error: "broken" } };
      }
      const body = req.body as Record<string, unknown> | undefined;
      if (!body) return { status: 400 };
      const keys = Object.keys(body);
      if (opts.partialPutOnly && keys.length > 1) {
        multiKey++;
        return { status: 422, body: { error: "use partial PUT" } };
      }
      handle.current = { ...handle.current, ...body };
      accepted++;
      return { status: 200, body: { ...handle.current } };
    }
    if (req.method === "DELETE") {
      deletes++;
      return { status: 204 };
    }
    return { status: 405 };
  };

  return handle;
}

/**
 * Build the `/projects/{id}` PUT/GET endpoint pair used in 5+ TASK-151/152
 * tests. Pass overrides for the request body schema; everything else is
 * boilerplate (path param, response 200, etc.).
 */
export interface ProjectPutGetOptions {
  /** When true, attach the put body schema as the GET response's schema field
   *  (some snapshot/restore paths key off this). Defaults to false to mirror
   *  the historical baseline behaviour. */
  attachResponseSchema?: boolean;
}

export function projectPutGetPair(
  putBodySchema: OpenAPIV3.SchemaObject,
  options: ProjectPutGetOptions = {},
): { put: ReturnType<typeof ep>; get: ReturnType<typeof ep> } {
  const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } } as unknown as OpenAPIV3.ParameterObject;
  const put = ep({
    method: "PUT",
    path: "/projects/{id}",
    requestBodySchema: putBodySchema,
    responses: [{ statusCode: 200, description: "ok" }],
    parameters: [idParam],
  });
  const get = ep({
    method: "GET",
    path: "/projects/{id}",
    requestBodySchema: undefined,
    requestBodyContentType: undefined,
    responses: options.attachResponseSchema
      ? [{ statusCode: 200, description: "ok", schema: putBodySchema }]
      : [{ statusCode: 200, description: "ok" }],
    parameters: [idParam],
  });
  return { put, get };
}

/**
 * Standard fetch installer used across the split files. Records every call
 * via `calls` and routes through the supplied `responder` (which can be
 * swapped per-test via the returned setter).
 */
export interface FetchHarness {
  calls: FetchCall[];
  setResponder: (r: Responder) => void;
  install: () => void;
  restore: () => void;
}

export function fetchHarness(): FetchHarness {
  let original: typeof fetch;
  const harness: FetchHarness = {
    calls: [],
    setResponder: (r) => { responder = r; },
    install: () => {
      original = globalThis.fetch;
      globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        let body: unknown;
        if (init?.body && typeof init.body === "string") {
          try { body = JSON.parse(init.body); } catch { body = init.body; }
        }
        const call: FetchCall = { url, method, body };
        harness.calls.push(call);
        const spec = responder(call);
        const text = spec.body === undefined ? "" : JSON.stringify(spec.body);
        return new Response(text, {
          status: spec.status,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;
    },
    restore: () => { globalThis.fetch = original; harness.calls = []; responder = () => ({ status: 200 }); },
  };
  let responder: Responder = () => ({ status: 200 });
  return harness;
}

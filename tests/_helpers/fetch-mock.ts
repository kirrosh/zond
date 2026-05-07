import { mock } from "bun:test";

export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

export interface FetchMockHandle {
  calls: FetchCall[];
  restore: () => void;
}

export interface FetchMockResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

const originalFetch = globalThis.fetch;

function recordCall(input: Request | string | URL, init?: RequestInit): FetchCall {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const rawBody = init?.body ?? (input instanceof Request ? undefined : undefined);
  let body: unknown = rawBody;
  if (typeof rawBody === "string") {
    try { body = JSON.parse(rawBody); } catch { body = rawBody; }
  }
  const headers: Record<string, string> = {};
  const initHeaders = init?.headers;
  if (initHeaders) {
    if (initHeaders instanceof Headers) {
      initHeaders.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(initHeaders)) {
      for (const [k, v] of initHeaders) headers[k] = v;
    } else {
      Object.assign(headers, initHeaders as Record<string, string>);
    }
  }
  return { url, method, body, headers };
}

function makeResponse(resp: FetchMockResponse): Response {
  const body = resp.body === undefined ? null : JSON.stringify(resp.body);
  return new Response(body, {
    status: resp.status,
    headers: { "Content-Type": "application/json", ...resp.headers },
  });
}

function install(handler: (input: Request | string | URL, init?: RequestInit) => Promise<Response>): FetchMockHandle {
  const calls: FetchCall[] = [];
  const prev = globalThis.fetch;
  globalThis.fetch = mock(async (input: Request | string | URL, init?: RequestInit) => {
    calls.push(recordCall(input, init));
    return handler(input, init);
  }) as unknown as typeof fetch;
  return {
    calls,
    restore: () => { globalThis.fetch = prev; },
  };
}

/** Sequence of canned responses; throws if exhausted. */
export function mockFetchSequence(responses: FetchMockResponse[]): FetchMockHandle {
  let i = 0;
  return install(async () => {
    const resp = responses[i++];
    if (!resp) throw new Error(`mockFetchSequence exhausted after ${responses.length} calls`);
    return makeResponse(resp);
  });
}

/** Always replies 200 OK with { ok: true, url }. */
export function mockFetchOk(): FetchMockHandle {
  return install(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new Response(JSON.stringify({ ok: true, url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

/** Route per-request via a callback. Return undefined for default 500. */
export function mockFetchRouter(
  handler: (call: FetchCall) => FetchMockResponse | undefined | Promise<FetchMockResponse | undefined>,
): FetchMockHandle {
  return install(async (input, init) => {
    const call = recordCall(input, init);
    const resp = await handler(call);
    return makeResponse(resp ?? { status: 500, body: { error: "unrouted" } });
  });
}

/** Restore the bun-process fetch baseline (use sparingly — usually `restore()` is enough). */
export function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

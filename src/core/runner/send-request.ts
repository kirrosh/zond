import { executeRequest } from "./http-client.ts";
import { loadEnvironment, substituteString, substituteDeep } from "../parser/variables.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByNameOrId } from "../../db/queries.ts";

function extractByPath(obj: unknown, path: string): unknown {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = parseInt(seg, 10);
      if (isNaN(idx)) return undefined;
      current = current[idx];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

export interface SendAdHocRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  envName?: string;
  collectionName?: string;
  jsonPath?: string;
  maxResponseChars?: number;
  dbPath?: string;
  searchDir?: string;
  /** Extra vars merged on top of env (e.g. captured values from a stored run). */
  extraVars?: Record<string, unknown>;
  /** When true, resolve interpolation but do not actually send the request. */
  dryRun?: boolean;
}

export interface SendAdHocRequestResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  duration_ms: number;
}

export interface ResolvedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export async function resolveAdHocRequest(options: SendAdHocRequestOptions): Promise<ResolvedRequest> {
  let searchDir = options.searchDir ?? process.cwd();
  if (options.collectionName) {
    getDb(options.dbPath);
    const col = findCollectionByNameOrId(options.collectionName);
    if (col?.base_dir) searchDir = col.base_dir;
  }
  const envVars = await loadEnvironment(options.envName, searchDir);
  const vars = options.extraVars ? { ...envVars, ...options.extraVars } : envVars;

  const resolvedUrl = substituteString(options.url, vars) as string;
  const parsedHeaders = options.headers ?? {};
  const resolvedHeaders = Object.keys(parsedHeaders).length > 0 ? substituteDeep(parsedHeaders, vars) : {};
  const resolvedBody = options.body ? substituteString(options.body, vars) as string : undefined;

  const finalHeaders: Record<string, string> = { ...resolvedHeaders };
  if (resolvedBody && !finalHeaders["Content-Type"] && !finalHeaders["content-type"]) {
    try {
      JSON.parse(resolvedBody);
      finalHeaders["Content-Type"] = "application/json";
    } catch {
      // Not JSON — don't set content-type, let server decide
    }
  }

  return {
    method: options.method,
    url: resolvedUrl,
    headers: finalHeaders,
    ...(resolvedBody !== undefined ? { body: resolvedBody } : {}),
  };
}

export async function sendAdHocRequest(options: SendAdHocRequestOptions): Promise<SendAdHocRequestResult> {
  const resolved = await resolveAdHocRequest(options);

  const response = await executeRequest(
    {
      method: resolved.method,
      url: resolved.url,
      headers: resolved.headers,
      body: resolved.body,
    },
    options.timeout ? { timeout: options.timeout } : undefined,
  );

  let responseBody: unknown = response.body_parsed ?? response.body;

  if (options.jsonPath && responseBody !== undefined) {
    responseBody = extractByPath(responseBody, options.jsonPath);
  }

  const result: SendAdHocRequestResult = {
    status: response.status,
    headers: response.headers,
    body: responseBody,
    duration_ms: response.duration_ms,
  };

  return result;
}

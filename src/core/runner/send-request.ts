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
}

export interface SendAdHocRequestResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  duration_ms: number;
}

export async function sendAdHocRequest(options: SendAdHocRequestOptions): Promise<SendAdHocRequestResult> {
  let searchDir = options.searchDir ?? process.cwd();
  if (options.collectionName) {
    getDb(options.dbPath);
    const col = findCollectionByNameOrId(options.collectionName);
    if (col?.base_dir) searchDir = col.base_dir;
  }
  const vars = await loadEnvironment(options.envName, searchDir);

  const resolvedUrl = substituteString(options.url, vars) as string;
  const parsedHeaders = options.headers ?? {};
  const resolvedHeaders = Object.keys(parsedHeaders).length > 0 ? substituteDeep(parsedHeaders, vars) : {};
  const resolvedBody = options.body ? substituteString(options.body, vars) as string : undefined;

  const response = await executeRequest(
    {
      method: options.method,
      url: resolvedUrl,
      headers: resolvedHeaders,
      body: resolvedBody,
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

import { executeRequest } from "./http-client.ts";
import { loadEnvironment, substituteString, substituteDeep } from "../parser/variables.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByNameOrId } from "../../db/queries.ts";
import { encodeFormBody } from "./form-encode.ts";

function hasHeaderCI(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

export function extractByPath(obj: unknown, path: string): unknown {
  return extractByPathWithDiagnostic(obj, path).value;
}

/** ARV-70 (feedback round-01 / F11): same extractor as above but also
 *  reports *why* the path failed. The CLI surfaces this on stderr when
 *  `--json-path` returns undefined so users don't lose minutes debugging
 *  "empty stdout despite data[0].id is right there in the JSON" — the
 *  hint pinpoints the segment that didn't resolve (e.g. "body is a string
 *  — content-type was not application/json"). */
export function extractByPathWithDiagnostic(
  obj: unknown,
  path: string,
): { value: unknown; resolved: string[]; failedAt?: string; reason?: string } {
  const segments = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  const resolved: string[] = [];
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) {
      return { value: undefined, resolved, failedAt: seg, reason: "previous segment resolved to null/undefined" };
    }
    if (Array.isArray(current)) {
      const idx = parseInt(seg, 10);
      if (isNaN(idx)) {
        return { value: undefined, resolved, failedAt: seg, reason: `expected an array index, got non-numeric segment "${seg}"` };
      }
      if (idx < 0 || idx >= current.length) {
        return { value: undefined, resolved, failedAt: seg, reason: `array index ${idx} out of bounds (length ${current.length})` };
      }
      current = current[idx];
    } else if (typeof current === "object") {
      const obj = current as Record<string, unknown>;
      if (!(seg in obj)) {
        const keys = Object.keys(obj).slice(0, 8).join(", ");
        return { value: undefined, resolved, failedAt: seg, reason: `key "${seg}" not in object (keys: ${keys || "<empty>"})` };
      }
      current = obj[seg];
    } else {
      return {
        value: undefined,
        resolved,
        failedAt: seg,
        reason: `cannot traverse "${seg}" — body is a ${typeof current === "string" ? "string (content-type may not be application/json)" : typeof current}`,
      };
    }
    resolved.push(seg);
  }
  return { value: current, resolved };
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
  /** ARV-149: when true, send the body as `application/x-www-form-urlencoded`.
   *  Parses `body` as JSON to lift fields, then re-encodes with bracket notation
   *  (Stripe-style nested keys). If `body` isn't JSON-parseable it's passed
   *  through verbatim, and only the Content-Type header is set. */
  form?: boolean;
}

export interface SendAdHocRequestResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  duration_ms: number;
  /** ARV-70: when --json-path failed to resolve, this carries which
   *  segment broke and why so the CLI can surface a hint on stderr. */
  jsonPathDiagnostic?: { resolved: string[]; failedAt?: string; reason?: string };
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
    if (!col) {
      throw new Error(`API '${options.collectionName}' is not registered. Run \`zond add api <name> --base-url <url>\` first, or check the name with \`zond db collections\`.`);
    }
    if (col.base_dir) searchDir = col.base_dir;
  }
  const envVars = await loadEnvironment(options.envName, searchDir);
  const vars = options.extraVars ? { ...envVars, ...options.extraVars } : envVars;

  // Auto-prefix base_url for relative paths when --api is in play.
  // Mirror the YAML-runner ergonomics: `zond request --api jp GET /users/1`
  // should work the same as `... GET '{{base_url}}/users/1'`. We touch the URL
  // only when it's clearly relative (leading "/") and has no scheme/template
  // already, so absolute URLs and explicit {{var}} templates pass through.
  let urlToResolve = options.url;
  if (
    options.collectionName
    && typeof vars.base_url === "string"
    && vars.base_url.length > 0
    && urlToResolve.startsWith("/")
    && !urlToResolve.startsWith("//")
  ) {
    const base = vars.base_url.replace(/\/+$/, "");
    urlToResolve = `${base}${urlToResolve}`;
  }

  const resolvedUrl = substituteString(urlToResolve, vars) as string;
  const parsedHeaders = options.headers ?? {};
  const resolvedHeaders = Object.keys(parsedHeaders).length > 0 ? substituteDeep(parsedHeaders, vars) : {};
  let resolvedBody = options.body ? substituteString(options.body, vars) as string : undefined;

  const finalHeaders: Record<string, string> = { ...resolvedHeaders };
  const hasContentType =
    finalHeaders["Content-Type"] !== undefined || finalHeaders["content-type"] !== undefined;

  // ARV-149: `--form` (or auto-detection from spec content type) re-encodes
  // the JSON body as `application/x-www-form-urlencoded` with bracket
  // notation. Stripe v1 and other Rails/PHP-style APIs declare ONLY form
  // bodies on their mutating endpoints — sending JSON yields a 400
  // "check that your POST content type is application/x-www-form-urlencoded".
  if (resolvedBody && options.form) {
    try {
      const parsed = JSON.parse(resolvedBody);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        resolvedBody = encodeFormBody(parsed as Record<string, unknown>);
      }
    } catch {
      // Body isn't JSON — assume it's already urlencoded; pass through verbatim.
    }
    if (!hasContentType) {
      finalHeaders["Content-Type"] = "application/x-www-form-urlencoded";
    }
  } else if (resolvedBody && !hasContentType) {
    try {
      JSON.parse(resolvedBody);
      finalHeaders["Content-Type"] = "application/json";
    } catch {
      // Not JSON — don't set content-type, let server decide
    }
  }

  // TASK-231: when --api resolved an env with `auth_token`, auto-inject the
  // standard `Authorization: Bearer …` header. This mirrors the YAML runner's
  // behaviour (probes/suites template the same header from the security
  // scheme) so `zond request --api X GET /…` doesn't 401 just because the
  // user didn't repeat `--header "Authorization: Bearer {{auth_token}}"`.
  // User-supplied Authorization always wins.
  if (
    options.collectionName
    && typeof vars.auth_token === "string"
    && vars.auth_token.length > 0
    && !hasHeaderCI(finalHeaders, "Authorization")
  ) {
    finalHeaders["Authorization"] = `Bearer ${vars.auth_token}`;
  }

  return {
    method: options.method,
    url: resolvedUrl,
    headers: finalHeaders,
    ...(resolvedBody !== undefined ? { body: resolvedBody } : {}),
  };
}

// Note: `options.form` is consumed inside `resolveAdHocRequest` itself —
// the encoded `body` string and Content-Type are baked into `finalHeaders`.
// `sendAdHocRequest` doesn't need to forward the flag separately.

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
  let jsonPathDiagnostic: SendAdHocRequestResult["jsonPathDiagnostic"];

  if (options.jsonPath && responseBody !== undefined) {
    const diag = extractByPathWithDiagnostic(responseBody, options.jsonPath);
    responseBody = diag.value;
    if (diag.value === undefined && diag.failedAt) {
      jsonPathDiagnostic = { resolved: diag.resolved, failedAt: diag.failedAt, reason: diag.reason };
    }
  }

  const result: SendAdHocRequestResult = {
    status: response.status,
    headers: response.headers,
    body: responseBody,
    duration_ms: response.duration_ms,
    ...(jsonPathDiagnostic ? { jsonPathDiagnostic } : {}),
  };

  return result;
}

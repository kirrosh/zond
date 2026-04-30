/**
 * TASK-102: build a JSON Pointer (RFC 6901) into the OpenAPI document for the
 * response branch a step exercises, plus a small excerpt of the schema at that
 * pointer. The excerpt is captured at run time and frozen into the DB so that
 * later spec edits can't rewrite history.
 *
 * Inputs come from {@link SourceMetadata} populated by TASK-100:
 *   - `endpoint`         e.g. "POST /webhooks"
 *   - `response_branch`  e.g. "422" or "400|422" (first wins for the pointer)
 */

import type { SourceMetadata } from "../parser/types.ts";

export interface SpecPointer {
  pointer: string;
  excerpt: string;
}

const EXCERPT_MAX_BYTES = 500;

function escapeJsonPointerSegment(s: string): string {
  return s.replace(/~/g, "~0").replace(/\//g, "~1");
}

function parseEndpoint(endpoint: string): { method: string; path: string } | null {
  const m = endpoint.match(/^([A-Z]+)\s+(\/.*)$/);
  if (!m) return null;
  return { method: m[1]!.toLowerCase(), path: m[2]! };
}

function pickPrimaryStatus(responseBranch: string | undefined): string | null {
  if (!responseBranch) return null;
  const first = responseBranch.split(/[|,\s]/).find((s) => /^\d{3}$/.test(s));
  return first ?? null;
}

function trimExcerpt(json: string): string {
  if (json.length <= EXCERPT_MAX_BYTES) return json;
  return json.slice(0, EXCERPT_MAX_BYTES) + "\n…[truncated]";
}

/**
 * Resolve the response operation in the OpenAPI document and produce a pointer
 * + frozen excerpt. Returns `null` if any link in the chain is missing — caller
 * persists `null` rather than crashing.
 */
export function buildSpecPointer(
  source: SourceMetadata | null | undefined,
  openApiDoc: unknown,
): SpecPointer | null {
  if (!source || !openApiDoc || typeof openApiDoc !== "object") return null;
  if (typeof source.endpoint !== "string") return null;

  const parsed = parseEndpoint(source.endpoint);
  if (!parsed) return null;
  const status = pickPrimaryStatus(source.response_branch ?? undefined);
  if (!status) return null;

  const doc = openApiDoc as Record<string, unknown>;
  const paths = doc.paths as Record<string, unknown> | undefined;
  if (!paths || typeof paths !== "object") return null;

  const pathItem = paths[parsed.path] as Record<string, unknown> | undefined;
  if (!pathItem || typeof pathItem !== "object") return null;

  const operation = pathItem[parsed.method] as Record<string, unknown> | undefined;
  if (!operation || typeof operation !== "object") return null;

  const responses = operation.responses as Record<string, unknown> | undefined;
  if (!responses || typeof responses !== "object") return null;

  const response = (responses[status] ?? responses.default) as Record<string, unknown> | undefined;
  if (!response || typeof response !== "object") return null;

  const escapedPath = escapeJsonPointerSegment(parsed.path);
  let pointer = `#/paths/${escapedPath}/${parsed.method}/responses/${status}`;
  let excerptValue: unknown = response;

  // Drill into application/json schema when available — that's the most useful
  // surface for UI rendering ("backend promised X, returned Y").
  const content = response.content as Record<string, unknown> | undefined;
  if (content && typeof content === "object") {
    const jsonMedia = (content["application/json"] ?? content["application/json; charset=utf-8"]) as
      | Record<string, unknown>
      | undefined;
    if (jsonMedia && typeof jsonMedia === "object" && "schema" in jsonMedia) {
      pointer += "/content/application~1json/schema";
      excerptValue = jsonMedia.schema;
    }
  }

  let excerpt: string;
  try {
    excerpt = JSON.stringify(excerptValue, null, 2);
  } catch {
    excerpt = String(excerptValue);
  }
  return { pointer, excerpt: trimExcerpt(excerpt) };
}

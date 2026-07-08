/**
 * ARV-176: response-schema overlay. `schema-from-runs` (ARV-175) emits a
 * `patch.schema.json` of inferred response schemas keyed by `METHOD /path` →
 * status. `refresh-api --merge-schema` folds that patch into a persistent
 * overlay (`apis/<name>/.api-schema.local.yaml`) and applies it onto the
 * freshly-pulled spec.json.
 *
 * Why a dedicated overlay file (not `.api-resources.local.yaml`): that file
 * is resource-shaped (ResourceYaml[]); response schemas are a different
 * dimension and shoehorning them in would muddy both. Same survives-refresh
 * contract as ARV-111's resource overlay — refresh-api re-applies it on every
 * run, so an upstream re-pull never loses the mined schemas.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { JsonSchema } from "./infer-schema.ts";

export const SCHEMA_OVERLAY_FILENAME = ".api-schema.local.yaml";

/** `METHOD /path` → status code → JSON Schema. */
export type ResponseSchemaPatch = Record<string, Record<string, JsonSchema>>;

interface SchemaOverlayFile {
  version: 1;
  response_schemas: ResponseSchemaPatch;
}

export function overlayPath(baseDir: string): string {
  return join(baseDir, SCHEMA_OVERLAY_FILENAME);
}

/** Load the overlay for an API, or null when absent. */
export function loadSchemaOverlay(baseDir: string): ResponseSchemaPatch | null {
  const p = overlayPath(baseDir);
  if (!existsSync(p)) return null;
  try {
    const parsed = parseYaml(readFileSync(p, "utf-8")) as Partial<SchemaOverlayFile> | null;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed.response_schemas ?? null;
  } catch {
    return null;
  }
}

/** Union two patches; entries in `incoming` win on collision. */
export function mergePatch(base: ResponseSchemaPatch | null, incoming: ResponseSchemaPatch): ResponseSchemaPatch {
  const out: ResponseSchemaPatch = {};
  for (const [ep, byStatus] of Object.entries(base ?? {})) out[ep] = { ...byStatus };
  for (const [ep, byStatus] of Object.entries(incoming)) {
    out[ep] = { ...(out[ep] ?? {}), ...byStatus };
  }
  return out;
}

/** Persist the overlay (sorted for a stable, diff-friendly file). */
export function saveSchemaOverlay(baseDir: string, patch: ResponseSchemaPatch): void {
  const sorted: ResponseSchemaPatch = {};
  for (const ep of Object.keys(patch).sort()) {
    const byStatus = patch[ep]!;
    sorted[ep] = {};
    for (const st of Object.keys(byStatus).sort()) sorted[ep]![st] = byStatus[st]!;
  }
  const file: SchemaOverlayFile = { version: 1, response_schemas: sorted };
  writeFileSync(overlayPath(baseDir), stringifyYaml(file), "utf-8");
}

export interface ApplyOverlayResult {
  /** `METHOD /path status` labels that got a schema written. */
  applied: string[];
  /** Labels skipped because a schema already existed (no --force). */
  preserved: string[];
  /** Labels skipped because the endpoint no longer exists upstream. */
  conflicts: string[];
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

/**
 * Apply a response-schema patch onto a dereferenced OpenAPI doc, in place.
 * Fills `responses.<status>.content['application/json'].schema` where it is
 * absent (or with `force`). An endpoint/method missing from the doc is a
 * conflict (upstream drift) and is skipped, not fabricated.
 */
export function applySchemaOverlay(
  doc: unknown,
  patch: ResponseSchemaPatch,
  opts: { force?: boolean } = {},
): ApplyOverlayResult {
  const result: ApplyOverlayResult = { applied: [], preserved: [], conflicts: [] };
  const paths = (doc as { paths?: Record<string, unknown> }).paths;
  if (!paths) {
    for (const [ep, byStatus] of Object.entries(patch)) {
      for (const st of Object.keys(byStatus)) result.conflicts.push(`${ep} ${st}`);
    }
    return result;
  }

  for (const [endpoint, byStatus] of Object.entries(patch)) {
    const sp = endpoint.indexOf(" ");
    const method = endpoint.slice(0, sp).toLowerCase();
    const path = endpoint.slice(sp + 1);
    const pathItem = paths[path] as Record<string, unknown> | undefined;
    const op = pathItem && HTTP_METHODS.includes(method)
      ? (pathItem[method] as { responses?: Record<string, unknown> } | undefined)
      : undefined;

    for (const [status, schema] of Object.entries(byStatus)) {
      const label = `${endpoint} ${status}`;
      if (!op) {
        result.conflicts.push(label);
        continue;
      }
      if (!op.responses) op.responses = {};
      const responses = op.responses as Record<string, { content?: Record<string, { schema?: unknown }> }>;
      if (!responses[status]) responses[status] = { content: {} } as { content: Record<string, { schema?: unknown }> };
      const resp = responses[status]!;
      if (!resp.content) resp.content = {};
      const mt = resp.content["application/json"] ?? (resp.content["application/json"] = {});
      if (mt.schema !== undefined && !opts.force) {
        result.preserved.push(label);
        continue;
      }
      mt.schema = schema;
      result.applied.push(label);
    }
  }
  return result;
}

import type { EndpointInfo } from "./types.ts";

const CHUNK_THRESHOLD = 30;

export interface ChunkPlan {
  totalEndpoints: number;
  needsChunking: boolean;
  chunks: Array<{ tag: string; count: number }>;
}

/**
 * Group endpoints by their first tag. TASK-36: untagged endpoints fall
 * back to per-resource grouping (first path segment), so `/audiences` and
 * `/audiences/{id}` land in the same `audiences` group instead of being
 * piled into a single `untagged` bucket. Endpoints whose path has no
 * usable first segment (e.g. `/`) keep the legacy `untagged` key.
 */
export function groupEndpointsByTag(endpoints: EndpointInfo[]): Map<string, EndpointInfo[]> {
  return Map.groupBy(endpoints, (ep) => ep.tags[0] ?? resourceKeyFromPath(ep.path));
}

/** Extract the first non-templated path segment for tagless fallback. */
function resourceKeyFromPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  for (const seg of segments) {
    // Skip templated segments like {id} — they aren't resource names.
    if (seg.startsWith("{") && seg.endsWith("}")) continue;
    if (seg.length === 0) continue;
    return seg;
  }
  return "untagged";
}

/** Decide whether to chunk, and return the tag breakdown */
function planChunks(endpoints: EndpointInfo[]): ChunkPlan {
  const groups = groupEndpointsByTag(endpoints);
  const chunks = Array.from(groups.entries())
    .map(([tag, eps]) => ({ tag, count: eps.length }))
    .sort((a, b) => b.count - a.count);

  return {
    totalEndpoints: endpoints.length,
    needsChunking: endpoints.length > CHUNK_THRESHOLD,
    chunks,
  };
}

/**
 * Filter endpoints by tag (case-insensitive). Accepts a single tag or a
 * comma-separated list (TASK-239) so callers can run one generate pass for
 * multiple tags instead of looping in the shell — looping prints
 * "Next steps" N times and drowns real warnings.
 */
export function filterByTag(endpoints: EndpointInfo[], tag: string): EndpointInfo[] {
  const wanted = tag
    .split(",")
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0);
  if (wanted.length === 0) return [];
  const includeUntagged = wanted.includes("untagged");
  const explicit = wanted.filter(t => t !== "untagged");
  return endpoints.filter(ep => {
    if (includeUntagged && ep.tags.length === 0) return true;
    return ep.tags.some(t => explicit.includes(t.trim().toLowerCase()));
  });
}

/** Collect the unique set of tags across all endpoints (sorted, original casing). */
export function collectTags(endpoints: EndpointInfo[]): string[] {
  const seen = new Map<string, string>();
  for (const ep of endpoints) {
    for (const t of ep.tags) {
      const key = t.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, t.trim());
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

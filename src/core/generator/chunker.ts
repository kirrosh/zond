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
  const groups = new Map<string, EndpointInfo[]>();
  for (const ep of endpoints) {
    const key = ep.tags[0] ?? resourceKeyFromPath(ep.path);
    const list = groups.get(key);
    if (list) list.push(ep);
    else groups.set(key, [ep]);
  }
  return groups;
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

/** Filter endpoints that have the given tag (case-insensitive) */
export function filterByTag(endpoints: EndpointInfo[], tag: string): EndpointInfo[] {
  const lower = tag.trim().toLowerCase();
  if (lower === "untagged") {
    return endpoints.filter(ep => ep.tags.length === 0);
  }
  return endpoints.filter(ep => ep.tags.some(t => t.trim().toLowerCase() === lower));
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

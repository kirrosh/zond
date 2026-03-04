import type { EndpointInfo } from "./types.ts";

export const CHUNK_THRESHOLD = 30;

export interface ChunkPlan {
  totalEndpoints: number;
  needsChunking: boolean;
  chunks: Array<{ tag: string; count: number }>;
}

/** Group endpoints by their first tag, or "untagged" if none */
export function groupEndpointsByTag(endpoints: EndpointInfo[]): Map<string, EndpointInfo[]> {
  const groups = new Map<string, EndpointInfo[]>();
  for (const ep of endpoints) {
    const tag = ep.tags[0] ?? "untagged";
    const list = groups.get(tag);
    if (list) {
      list.push(ep);
    } else {
      groups.set(tag, [ep]);
    }
  }
  return groups;
}

/** Decide whether to chunk, and return the tag breakdown */
export function planChunks(endpoints: EndpointInfo[]): ChunkPlan {
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
  const lower = tag.toLowerCase();
  if (lower === "untagged") {
    return endpoints.filter(ep => ep.tags.length === 0);
  }
  return endpoints.filter(ep => ep.tags.some(t => t.toLowerCase() === lower));
}

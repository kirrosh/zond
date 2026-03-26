import type { EndpointInfo } from "../generator/types.ts";
import { normalizePath } from "../generator/coverage-scanner.ts";

export interface SpecDiff {
  /** Endpoints in current spec not present in previous snapshot */
  newEndpoints: EndpointInfo[];
  /** Endpoint keys from previous snapshot not present in current spec */
  removedKeys: string[];
  /** True if spec content hash changed (could be just description changes) */
  specChanged: boolean;
}

/** Produce a normalized key for an endpoint: "GET /users/{*}" */
export function endpointKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizePath(path)}`;
}

/**
 * Compare current endpoints against previously-known endpoint keys
 * (stored as strings in .zond-meta.json).
 */
export function diffEndpoints(
  prevKeys: string[],
  currentEndpoints: EndpointInfo[],
): Omit<SpecDiff, "specChanged"> {
  const prevSet = new Set(prevKeys);
  const currentSet = new Set(
    currentEndpoints.map((ep) => endpointKey(ep.method, ep.path)),
  );

  const newEndpoints = currentEndpoints.filter(
    (ep) => !prevSet.has(endpointKey(ep.method, ep.path)),
  );

  const removedKeys = [...prevSet].filter((key) => !currentSet.has(key));

  return { newEndpoints, removedKeys };
}

/**
 * Deterministic union of two or more dereferenced OpenAPI documents into
 * one (ARV-375). Motivation: an org running multiple API versions
 * side-by-side (v1/v2, deprecated-but-live + current) wants combined
 * coverage instead of re-scanning each version and reconciling reports by
 * hand. Before this, that merge was a one-off python script per session.
 *
 * Policy — pure, deterministic, no judgment (belongs in zond core per the
 * litmus test):
 *   - `paths`: union; on a path-key collision the LATER spec wins, and the
 *     collision is recorded so the caller can warn (silent shadowing of a
 *     real endpoint is a correctness trap).
 *   - `components.*`: union per sub-bucket (schemas, securitySchemes,
 *     parameters, responses, …); later wins. A component-name collision
 *     whose two definitions DIFFER (deep-unequal) is reported separately —
 *     that is the dangerous case (same name, different shape).
 *   - `servers`, `security`, `tags`: unioned & de-duped by value/name.
 *   - `info`: taken from the first spec; `version` becomes the unique
 *     source versions joined with `+` so the merged target is self-labelling.
 *
 * Inputs are assumed already dereferenced (readOpenApiSpec output), so path
 * operations are self-contained — no cross-spec $ref resolution needed.
 */

import type { OpenAPIV3 } from "openapi-types";

export interface MergeInput {
  /** Source label (path or URL) for the merge summary. */
  source: string;
  doc: OpenAPIV3.Document;
}

export interface MergeSummary {
  sources: { source: string; paths: number }[];
  totalPaths: number;
  /** Path keys declared by more than one spec (later-wins applied). */
  pathCollisions: string[];
  /** `components.<bucket>.<name>` whose definition differs across specs. */
  schemaConflicts: string[];
}

export interface MergeResult {
  merged: OpenAPIV3.Document;
  summary: MergeSummary;
}

const COMPONENT_BUCKETS = [
  "schemas",
  "responses",
  "parameters",
  "examples",
  "requestBodies",
  "headers",
  "securitySchemes",
  "links",
  "callbacks",
] as const;

function deepEqual(a: unknown, b: unknown): boolean {
  // Cheap structural compare — specs are plain JSON after dereference.
  return JSON.stringify(a) === JSON.stringify(b);
}

export function mergeOpenApiDocs(inputs: MergeInput[]): MergeResult {
  if (inputs.length === 0) throw new Error("mergeOpenApiDocs: no specs to merge");
  const first = inputs[0]!.doc;

  const paths: NonNullable<OpenAPIV3.Document["paths"]> = {};
  const pathCollisions: string[] = [];
  const sources: MergeSummary["sources"] = [];

  for (const { source, doc } of inputs) {
    const specPaths = doc.paths ?? {};
    let count = 0;
    for (const [p, item] of Object.entries(specPaths)) {
      if (p in paths) pathCollisions.push(p);
      paths[p] = item as OpenAPIV3.PathItemObject;
      count++;
    }
    sources.push({ source, paths: count });
  }

  // Merge components bucket-by-bucket; flag same-name-different-shape.
  const schemaConflicts: string[] = [];
  const components: Record<string, Record<string, unknown>> = {};
  for (const { doc } of inputs) {
    const comps = (doc.components ?? {}) as Record<string, Record<string, unknown> | undefined>;
    for (const bucket of COMPONENT_BUCKETS) {
      const incoming = comps[bucket];
      if (!incoming) continue;
      const target = (components[bucket] ??= {});
      for (const [name, def] of Object.entries(incoming)) {
        if (name in target && !deepEqual(target[name], def)) {
          schemaConflicts.push(`${bucket}.${name}`);
        }
        target[name] = def;
      }
    }
  }

  // Union servers by url, security by value, tags by name.
  const servers = dedupeBy(
    inputs.flatMap((i) => i.doc.servers ?? []),
    (s) => s.url,
  );
  const security = dedupeBy(
    inputs.flatMap((i) => i.doc.security ?? []),
    (s) => JSON.stringify(s),
  );
  const tags = dedupeBy(
    inputs.flatMap((i) => i.doc.tags ?? []),
    (t) => t.name,
  );

  const versions = dedupe(inputs.map((i) => i.doc.info?.version).filter(Boolean) as string[]);

  const merged: OpenAPIV3.Document = {
    ...first,
    openapi: first.openapi ?? "3.0.0",
    info: {
      ...first.info,
      version: versions.join("+") || first.info?.version || "merged",
    },
    paths,
    ...(Object.keys(components).length > 0 ? { components: components as OpenAPIV3.ComponentsObject } : {}),
    ...(servers.length > 0 ? { servers } : {}),
    ...(security.length > 0 ? { security } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };

  return {
    merged,
    summary: {
      sources,
      totalPaths: Object.keys(paths).length,
      pathCollisions: dedupe(pathCollisions),
      schemaConflicts: dedupe(schemaConflicts),
    },
  };
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function dedupeBy<T>(arr: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

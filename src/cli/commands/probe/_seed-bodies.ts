/**
 * ARV-269: shared loader for agent-authored `seed_body` overlays.
 *
 * Stateful checks already consume `.api-resources.local.yaml::seed_body`
 * via `resolveCreateBody` (`core/checks/checks/_crud-helpers.ts`). Before
 * ARV-269 the live probes (mass-assignment, security) did not — every
 * baseline POST fell back to `generateFromSchema`, which strict APIs like
 * Stripe v1 routinely reject as 400 with `INCONCLUSIVE-baseline`. The
 * agent-authored overlay (ARV-187 pipeline) silently lost half its ROI.
 *
 * This helper builds the `Map<"METHOD path", SeedBodyConfig>` the probe
 * runners consume. It's a CLI-layer helper because it crosses into
 * `cli/commands/discover.ts` (the resource-map loader); keeping it under
 * `core/probe` would inject a CLI dependency into the runtime.
 */
import { resolveApiCollection } from "../../resolve.ts";
import { readResourceMap } from "../discover.ts";
import type { SeedBodyConfig } from "../../../core/generator/resources-builder.ts";

/** Parse the "METHOD /path" labels used in `.api-resources.yaml`. */
function parseLabel(label: string): { method: string; path: string } | null {
  const parts = label.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return { method: parts[0]!.toUpperCase(), path: parts[1]! };
}

/**
 * Returns undefined when no API context is in scope (raw `--spec`
 * invocation) or when no resource declares `seed_body`. Probe runners
 * treat undefined as "no overlay" and keep the legacy generator path.
 */
export async function loadSeedBodyOverlays(
  apiName: string | undefined,
  dbPath?: string,
): Promise<Map<string, SeedBodyConfig> | undefined> {
  if (!apiName) return undefined;
  const col = resolveApiCollection(apiName, dbPath);
  if ("error" in col || !col.baseDir) return undefined;
  const map = await readResourceMap(col.baseDir);
  if (!map) return undefined;
  const out = new Map<string, SeedBodyConfig>();
  for (const r of map.resources) {
    if (!r.seed_body || !r.endpoints?.create) continue;
    const parsed = parseLabel(r.endpoints.create);
    if (!parsed) continue;
    out.set(`${parsed.method} ${parsed.path}`, {
      contentType: r.seed_body.content_type,
      body: r.seed_body.body,
    });
  }
  return out.size > 0 ? out : undefined;
}

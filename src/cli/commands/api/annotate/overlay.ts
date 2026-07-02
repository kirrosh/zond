/**
 * ARV-187: read / merge / write `.api-resources.local.yaml`.
 *
 * The annotate command writes _only_ into the `patches:` block. That's
 * the ARV-169 field-level overlay (see discover.ts:readResourcePatches)
 * — strictly additive, doesn't touch the upstream `.api-resources.yaml`.
 * The `extensions:` block (ARV-111, full-resource replacement) is left
 * intact when we re-write the file, so users can mix annotate-generated
 * patches with hand-written extensions.
 *
 * Idempotent re-annotation: when a patch field already exists in the
 * overlay, we compare values. Equal → no-op (keep existing). Different
 * → conflict (surface in diff, requires --yes to overwrite, or --keep
 * to skip).
 */

import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import type { ResourceYaml } from "../../discover.ts";

export type ResourcePatch = Partial<ResourceYaml> & { resource: string };

export interface LocalOverlayFile {
  extensions?: ResourceYaml[];
  patches?: ResourcePatch[];
  /** Any other top-level keys the user added (preserved on rewrite). */
  [key: string]: unknown;
}

const FILENAME = ".api-resources.local.yaml";

export async function readLocalOverlay(apiDir: string): Promise<LocalOverlayFile> {
  const file = Bun.file(join(apiDir, FILENAME));
  if (!(await file.exists())) return {};
  const parsed = Bun.YAML.parse(await file.text());
  if (!parsed || typeof parsed !== "object") return {};
  return parsed as LocalOverlayFile;
}

export async function writeLocalOverlay(apiDir: string, overlay: LocalOverlayFile): Promise<void> {
  const path = join(apiDir, FILENAME);
  const header = `# .api-resources.local.yaml — local overlay (ARV-111 / ARV-169 / ARV-187)
#
# extensions: full ResourceYaml entries that REPLACE the upstream entry
#             (by resource name) or ADD a new one.
# patches:    partial overlay — fields here are merged onto the matching
#             upstream entry (idempotency / pagination / lifecycle /
#             readback_diff / seed_body).
#
# This file is checked into git. Edit by hand or via \`zond api annotate\`.
`;
  // Bun.YAML doesn't have a stringify; use the yaml package.
  const { stringify } = await import("yaml");
  const body = stringify(overlay, { lineWidth: 0, defaultStringType: "PLAIN" });
  await writeFile(path, header + "\n" + body, "utf-8");
}

export interface MergeConflict {
  resource: string;
  field: string;
  existing: unknown;
  proposed: unknown;
}

export interface MergeResult {
  /** New patches array, with proposed merged over existing. */
  patches: ResourcePatch[];
  /** Per-resource per-field conflicts (existing value differs from proposed). */
  conflicts: MergeConflict[];
  /** Per-resource per-field accepted changes (new field, or overwrite when force=true). */
  changes: MergeConflict[];
}

/**
 * Merge proposed patches into existing patches.
 *
 * Conflict policy:
 *   - Field absent in existing → added (counts as a `change`).
 *   - Field present and structurally equal → kept (no-op).
 *   - Field present and different → if force=true, overwritten and
 *     counted as both `change` and `conflict`; else kept and counted
 *     as `conflict` only.
 *
 * "Structural equality" uses JSON stringification with stable key order;
 * good enough for yaml-roundtrip data which is plain JSON-shaped.
 */
export function mergePatches(
  existing: ResourcePatch[],
  proposed: ResourcePatch[],
  opts: { force?: boolean } = {},
): MergeResult {
  const force = opts.force === true;
  const byName = new Map<string, ResourcePatch>();
  for (const p of existing) byName.set(p.resource, deepClone(p));
  const conflicts: MergeConflict[] = [];
  const changes: MergeConflict[] = [];

  for (const proposedPatch of proposed) {
    const name = proposedPatch.resource;
    const current = byName.get(name) ?? { resource: name };
    for (const [field, proposedVal] of Object.entries(proposedPatch)) {
      if (field === "resource") continue;
      const existingVal = (current as Record<string, unknown>)[field];
      if (existingVal === undefined) {
        (current as Record<string, unknown>)[field] = proposedVal;
        changes.push({ resource: name, field, existing: undefined, proposed: proposedVal });
        continue;
      }
      if (structurallyEqual(existingVal, proposedVal)) continue;
      // Conflict.
      conflicts.push({ resource: name, field, existing: existingVal, proposed: proposedVal });
      if (force) {
        (current as Record<string, unknown>)[field] = proposedVal;
        changes.push({ resource: name, field, existing: existingVal, proposed: proposedVal });
      }
    }
    byName.set(name, current);
  }

  return { patches: [...byName.values()], conflicts, changes };
}

function structurallyEqual(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableJson).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableJson(obj[k])).join(",") + "}";
}

function deepClone<T>(v: T): T {
  return structuredClone(v);
}

/**
 * Render a unified, human-readable diff of the changes a merge produced.
 * Returns "" when there are no changes.
 *
 * Format (kept simple so it works in plain stdout, no chalk dep):
 *
 *   resource: customers
 *     + seed_body:
 *         content_type: application/x-www-form-urlencoded
 *         body:
 *           description: 'zond probe customer'
 *           email: 'probe@example.com'
 *     ~ idempotency: (conflict — kept existing)
 *         existing: { header: Idempotency-Key }
 *         proposed: { header: X-Idempotency }
 */
export function renderChangesDiff(result: MergeResult): string {
  const lines: string[] = [];
  const byResource = new Map<string, { changes: MergeConflict[]; conflicts: MergeConflict[] }>();
  for (const c of result.changes) {
    if (!byResource.has(c.resource)) byResource.set(c.resource, { changes: [], conflicts: [] });
    byResource.get(c.resource)!.changes.push(c);
  }
  for (const c of result.conflicts) {
    if (!byResource.has(c.resource)) byResource.set(c.resource, { changes: [], conflicts: [] });
    byResource.get(c.resource)!.conflicts.push(c);
  }
  for (const [resource, group] of byResource) {
    lines.push(`resource: ${resource}`);
    for (const ch of group.changes) {
      const op = ch.existing === undefined ? "+" : "~";
      lines.push(`  ${op} ${ch.field}:`);
      lines.push(indent(yamlSnippet(ch.proposed), 6));
    }
    for (const cf of group.conflicts) {
      // Skip if already rendered as a change (force=true case).
      if (group.changes.some((c) => c.field === cf.field && c.existing !== undefined)) continue;
      lines.push(`  ! ${cf.field}: (conflict — kept existing; pass --yes to overwrite)`);
      lines.push(`      existing: ${oneLineYaml(cf.existing)}`);
      lines.push(`      proposed: ${oneLineYaml(cf.proposed)}`);
    }
  }
  return lines.join("\n");
}

function yamlSnippet(v: unknown): string {
  // Reuse yaml package for nested rendering.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { stringify } = require("yaml") as { stringify: (v: unknown, opts?: unknown) => string };
    return stringify(v, { lineWidth: 0 }).trimEnd();
  } catch {
    return JSON.stringify(v, null, 2);
  }
}

function oneLineYaml(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function indent(text: string, n: number): string {
  const pad = " ".repeat(n);
  return text.split("\n").map((l) => pad + l).join("\n");
}

/**
 * ARV-187: `zond api annotate` — agent-augmented overlay authoring.
 *
 * zond does NOT call an LLM and does NOT carry LLM prompt text.
 * It exposes two phases that bracket the agent's own inference:
 *
 *   1. `zond api annotate dump --<kind>` — emit raw, per-resource
 *      spec slices + the expected response shape (zod-derived contract).
 *      The agent reads them, decides how to ask its model, generates
 *      one YAML response per resource.
 *
 *   2. `zond api annotate apply --<kind> --input <file|->` — read the
 *      agent's YAML response, validate via zod, render a diff against
 *      the existing `.api-resources.local.yaml`, and (with --yes) write.
 *
 * The agent owns prompt formulation, model choice, and inference. zond
 * owns spec-parsing, response validation, and overlay I/O. No network
 * calls from zond, no API keys, deterministic binary behaviour.
 */

import { join } from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Command } from "commander";
import type { OpenAPIV3 } from "openapi-types";
import { resolveApiCollection } from "../../../resolve.ts";
import { readOpenApiSpec } from "../../../../core/generator/openapi-reader.ts";
import { readResourceMap, readFixtureManifest, type ResourceYaml, type FixtureManifestYaml } from "../../discover.ts";
import { loadEnvFile } from "../../../../core/parser/variables.ts";
import { buildResourceSlices, type ResourceSlice, type EndpointDump } from "./prompts.ts";
import { readLocalOverlay, writeLocalOverlay, mergePatches, renderChangesDiff, type ResourcePatch } from "./overlay.ts";
import * as seedBodies from "./seed-bodies.ts";
import * as lifecycle from "./lifecycle.ts";
import * as idempotency from "./idempotency.ts";
import * as pagination from "./pagination.ts";
import * as readback from "./readback.ts";
import * as resourcesModule from "./resources.ts";
import * as auto from "./auto.ts";
import { printError, printSuccess, printWarning } from "../../../output.ts";
import { jsonOk, jsonError, printJson } from "../../../json-envelope.ts";
import { globalJson } from "../../../resolve.ts";

type SubcommandKind = "seed-bodies" | "lifecycle" | "idempotency" | "pagination" | "readback" | "resources";

// ─── Dump phase ──────────────────────────────────────────────────────

export interface DumpBundle {
  kind: SubcommandKind;
  /** "*orphans*" for kind=resources; resource name otherwise. */
  resource: string;
  /** Output of buildResourceSlices for a single resource — endpoints,
   *  schemas, descriptions, x-codeSamples. The raw material. */
  data: unknown;
  /** zod-derived shape of the YAML response zond will accept in `apply`.
   *  Not an LLM prompt — a typed contract the agent can reference. */
  expected_response_shape: unknown;
}

const EXPECTED_SHAPES: Record<SubcommandKind, unknown> = {
  "seed-bodies": seedBodies.EXPECTED_OUTPUT_SHAPE,
  "lifecycle":   lifecycle.EXPECTED_OUTPUT_SHAPE,
  "idempotency": idempotency.EXPECTED_OUTPUT_SHAPE,
  "pagination":  pagination.EXPECTED_OUTPUT_SHAPE,
  "readback":    readback.EXPECTED_OUTPUT_SHAPE,
  "resources":   resourcesModule.EXPECTED_OUTPUT_SHAPE,
};

export interface DumpOptions {
  api: string;
  kind: SubcommandKind;
  only?: string[];
  json?: boolean;
  dbPath?: string;
  /** ARV-277: enrich seed-bodies bundles with the most recent
   *  fixture-kind POST attempt to the create endpoint, so the calling
   *  agent sees exactly what zond tried last + how the server replied
   *  (avoids the "agent re-discovers each 400 by hand" loop). */
  withLastAttempt?: boolean;
}

export async function dumpCommand(opts: DumpOptions): Promise<number> {
  const col = resolveApiCollection(opts.api, opts.dbPath);
  if ("error" in col) { printError(col.error); return 2; }
  if (!col.baseDir || !col.spec) {
    printError(`API '${opts.api}' has no spec/base_dir registered.`);
    return 2;
  }

  const doc = await readOpenApiSpec(col.spec);
  const map = await readResourceMap(col.baseDir);
  if (!map) {
    printError(`API '${opts.api}' has no .api-resources.yaml. Run \`zond refresh-api ${opts.api}\` first.`);
    return 2;
  }

  let resources = map.resources;
  let unknownOnly: string[] = [];
  if (opts.only && opts.only.length > 0) {
    const wanted = new Set(opts.only);
    const knownNames = new Set(map.resources.map((r) => r.resource));
    unknownOnly = opts.only.filter((n) => !knownNames.has(n));
    resources = resources.filter((r) => wanted.has(r.resource));
  }
  const slices = buildResourceSlices(doc, resources);
  const bundles = buildDumpBundles(opts.kind, slices, doc, map.resources);

  // ARV-277: enrich seed-bodies bundles with the last fixture-kind POST
  // attempt (from `runs/results` DB). The agent reads `last_attempt`
  // alongside the spec slice instead of running `zond request POST …`
  // by hand to reproduce the failure mode.
  if (opts.withLastAttempt && opts.kind === "seed-bodies") {
    try {
      const { getLastFixturePost } = await import("../../../../db/queries/results.ts");
      for (const b of bundles) {
        const data = b.data as Record<string, unknown> | null;
        const endpoints = data?.endpoints as Record<string, EndpointDump | undefined> | undefined;
        const create = endpoints?.create;
        if (!create) continue;
        const pattern = createUrlLikePattern(create.path);
        const last = getLastFixturePost(pattern);
        if (last) (b.data as Record<string, unknown>).last_attempt = last;
      }
    } catch (err) {
      // DB lookup is best-effort — degraded dump (no `last_attempt`) is
      // still useful, so we warn but don't fail the command.
      process.stderr.write(`zond: --with-last-attempt: DB lookup failed (${(err as Error).message}); dump emitted without last_attempt.\n`);
    }
  }

  // ARV-226: when `--only` filtered to resources that have no applicable
  // surface for this kind (no list endpoint for pagination/readback, no
  // write surface for idempotency/seed-bodies, etc.), the dump silently
  // returns []. Distinguish "no surface" from "unknown resource" so the
  // user can tell whether they mistyped or hit a category-not-applicable.
  if (!opts.json && opts.only && opts.only.length > 0 && opts.kind !== "resources") {
    const emitted = new Set(bundles.map((b) => b.resource));
    const filteredButNoSurface = opts.only.filter(
      (n) => !emitted.has(n) && !unknownOnly.includes(n),
    );
    for (const n of unknownOnly) {
      process.stderr.write(`zond: --only: resource '${n}' not in .api-resources.yaml (refresh-api or check spelling).\n`);
    }
    for (const n of filteredButNoSurface) {
      process.stderr.write(`zond: --only: resource '${n}' has no applicable surface for --${opts.kind} (skipped).\n`);
    }
  }

  if (opts.json) {
    printJson(jsonOk("api annotate dump", { kind: opts.kind, bundles }));
  } else {
    process.stdout.write(JSON.stringify(bundles, null, 2) + "\n");
  }
  return 0;
}

/**
 * ARV-277: convert a create-endpoint path (`/v1/customers/{customer}/sources`)
 * to a SQL LIKE pattern matched against full request_url
 * (`https://api.stripe.com/v1/customers/cus_…/sources?...`). Path-params
 * collapse to `%`; the prefix and suffix wildcards cover the scheme/host
 * and optional query string. Anchoring is intentionally loose because
 * recorders write absolute URLs and we want to find the seed POST
 * regardless of base_url shape.
 */
export function createUrlLikePattern(createPath: string): string {
  const collapsed = createPath.replace(/\{[^}]+\}/g, "%");
  // SQL LIKE `%` matches across slashes (no special escape needed for
  // the path segments since we don't expect %/_ in spec paths). Leading
  // wildcard absorbs `https://api.stripe.com`, trailing absorbs `?expand=…`.
  return `%${collapsed}%`;
}

function buildDumpBundles(
  kind: SubcommandKind,
  slices: ResourceSlice[],
  doc: OpenAPIV3.Document,
  allResources: ResourceYaml[],
): DumpBundle[] {
  if (kind === "resources") {
    const claimedPaths = new Set<string>();
    for (const r of allResources) {
      for (const role of ["list", "create", "read", "update", "delete"] as const) {
        const ep = r.endpoints[role];
        if (ep) claimedPaths.add(ep.split(/\s+/)[1] ?? "");
      }
    }
    const orphans: string[] = [];
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      if (!item || typeof item !== "object") continue;
      for (const method of ["get", "post", "put", "patch", "delete"]) {
        if (!(item as Record<string, unknown>)[method]) continue;
        if (claimedPaths.has(path)) continue;
        orphans.push(`${method.toUpperCase()} ${path}`);
      }
    }
    if (orphans.length === 0) return [];
    return [{
      kind,
      resource: "*orphans*",
      data: {
        orphan_endpoints: orphans,
        existing_resources: allResources.map((r) => ({ resource: r.resource, basePath: r.basePath })),
      },
      expected_response_shape: EXPECTED_SHAPES[kind],
    }];
  }

  const out: DumpBundle[] = [];
  for (const slice of slices) {
    if (!isSliceApplicable(kind, slice)) continue;
    let data: unknown;
    switch (kind) {
      case "seed-bodies":
      case "idempotency":
      case "readback":
        data = sliceData(slice);
        break;
      case "pagination": {
        // ARV-235: when the list endpoint already declares standard
        // page-style params, agent doesn't need to re-read the full
        // params schema to produce the annotation — surface a precomputed
        // hint so the response can be `{ type: page, page_param, limit_param }`
        // without inspecting the spec slice further.
        const hint = detectPaginationHint(slice);
        const base = sliceData(slice) as Record<string, unknown>;
        data = hint ? { ...base, pagination_hint: hint } : base;
        break;
      }
      case "lifecycle":
        data = {
          ...(sliceData(slice) as Record<string, unknown>),
          action_endpoint_candidates: collectActionEndpoints(doc, slice),
        };
        break;
      default: throw new Error(`unhandled kind: ${kind}`);
    }
    out.push({
      kind,
      resource: slice.resource,
      data,
      expected_response_shape: EXPECTED_SHAPES[kind],
    });
  }
  return out;
}

function sliceData(slice: ResourceSlice): unknown {
  return {
    resource: slice.resource,
    basePath: slice.basePath,
    itemPath: slice.itemPath,
    endpoints: slice.endpoints,
  };
}

/**
 * ARV-235: detect well-known page-style pagination params on the list
 * endpoint so the dump's response shape becomes a one-liner for the
 * agent. Returns null if the params don't match a known shape — the
 * agent then walks the full slice as before.
 */
function detectPaginationHint(slice: ResourceSlice): null | {
  detected_style: "page" | "offset";
  page_param?: string;
  limit_param?: string;
  offset_param?: string;
  note: string;
} {
  const list = slice.endpoints.list;
  if (!list || !list.parameters) return null;
  const queryNames = new Set(
    list.parameters.filter((p) => p.in === "query").map((p) => p.name.toLowerCase()),
  );
  const pageParam = ["page"].find((n) => queryNames.has(n));
  const limitParam = ["per_page", "page_size", "pagesize", "limit"].find((n) => queryNames.has(n));
  const offsetParam = ["offset", "skip", "start"].find((n) => queryNames.has(n));
  if (pageParam) {
    return {
      detected_style: "page",
      page_param: pageParam,
      limit_param: limitParam,
      note: "list endpoint declares page-style params; respond with { type: 'page', page_param, limit_param } to skip rereading the full spec slice.",
    };
  }
  if (offsetParam) {
    return {
      detected_style: "offset",
      offset_param: offsetParam,
      limit_param: limitParam,
      note: "list endpoint declares offset-style params; pagination check short-circuits offset/token (per m-20). Skip annotation for this resource or return { pagination: null }.",
    };
  }
  return null;
}

function isSliceApplicable(kind: SubcommandKind, slice: ResourceSlice): boolean {
  switch (kind) {
    case "seed-bodies": return seedBodies.isApplicable(slice);
    case "lifecycle":   return lifecycle.isApplicable(slice);
    case "idempotency": return idempotency.isApplicable(slice);
    case "pagination":  return pagination.isApplicable(slice);
    case "readback":    return readback.isApplicable(slice);
    case "resources":   return true;
  }
}

function collectActionEndpoints(doc: OpenAPIV3.Document, slice: ResourceSlice): EndpointDump[] {
  const out: EndpointDump[] = [];
  const claimed = new Set<string>();
  for (const role of ["list", "create", "read", "update", "delete"] as const) {
    const ep = slice.endpoints[role];
    if (ep) claimed.add(`${ep.method} ${ep.path}`);
  }
  const baseLen = slice.basePath.length;
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (!item || typeof item !== "object") continue;
    if (!path.startsWith(slice.basePath)) continue;
    const tail = path.slice(baseLen);
    if (!/\/\{[^}]+\}\/[a-zA-Z]/.test(tail)) continue;
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = (item as Record<string, unknown>)[method];
      if (!op) continue;
      const key = `${method.toUpperCase()} ${path}`;
      if (claimed.has(key)) continue;
      out.push({
        method: method.toUpperCase(),
        path,
        operationId: (op as { operationId?: string }).operationId,
        summary: (op as { summary?: string }).summary,
        description: ((op as { description?: string }).description ?? "").slice(0, 240),
      });
    }
  }
  return out;
}

// ─── Apply phase ─────────────────────────────────────────────────────

export interface ApplyOptions {
  api: string;
  kind: SubcommandKind;
  input: string;
  yes?: boolean;
  force?: boolean;
  json?: boolean;
  dbPath?: string;
}

export async function applyCommand(opts: ApplyOptions): Promise<number> {
  const col = resolveApiCollection(opts.api, opts.dbPath);
  if ("error" in col) { printError(col.error); return 2; }
  if (!col.baseDir || !col.spec) {
    printError(`API '${opts.api}' has no spec/base_dir registered.`);
    return 2;
  }

  const doc = await readOpenApiSpec(col.spec);
  const map = await readResourceMap(col.baseDir);
  if (!map) {
    printError(`API '${opts.api}' has no .api-resources.yaml.`);
    return 2;
  }
  const slicesByName = new Map<string, ResourceSlice>();
  for (const s of buildResourceSlices(doc, map.resources)) slicesByName.set(s.resource, s);

  const inputText = await readInput(opts.input);
  const documents = parseYamlDocuments(inputText);
  if (documents.length === 0) {
    printError(`No YAML documents found in input (${opts.input}).`);
    return 2;
  }

  if (opts.kind === "resources") {
    return applyResources(col.baseDir, documents, opts);
  }

  const drafts: Array<{ patch: ResourcePatch; audit: Record<string, unknown> }> = [];
  const errors: Array<{ resource: string; error: string }> = [];

  for (const document of documents) {
    const resourceName = (document as { resource?: string } | null)?.resource;
    if (typeof resourceName !== "string") {
      errors.push({ resource: "<unknown>", error: "document missing 'resource:' field" });
      continue;
    }
    const slice = slicesByName.get(resourceName);
    if (!slice) {
      errors.push({ resource: resourceName, error: "resource not present in .api-resources.yaml — refresh-api first?" });
      continue;
    }
    try {
      drafts.push(parseByKind(opts.kind, document, slice));
    } catch (err) {
      errors.push({ resource: resourceName, error: (err as Error).message });
    }
  }

  const nonEmpty = drafts.filter((d) => Object.keys(d.patch).filter((k) => k !== "resource").length > 0);

  const overlay = await readLocalOverlay(col.baseDir);
  const existing = (overlay.patches ?? []) as ResourcePatch[];
  const merge = mergePatches(existing, nonEmpty.map((d) => d.patch), { force: opts.force === true });

  const summary = {
    api: opts.api,
    kind: opts.kind,
    inputDocuments: documents.length,
    accepted: nonEmpty.length,
    dropped: drafts.length - nonEmpty.length,
    failures: errors,
    changes: merge.changes.length,
    conflicts: merge.conflicts.length,
  };

  const diff = renderChangesDiff(merge);
  if (!opts.json) {
    if (errors.length > 0) {
      printWarning(`Failed to parse ${errors.length} document(s):`);
      for (const e of errors) process.stdout.write(`  ✗ ${e.resource}: ${e.error}\n`);
    }
    if (diff) {
      process.stdout.write("\nProposed changes (and conflicts):\n");
      process.stdout.write(diff + "\n\n");
    } else {
      process.stdout.write("No changes proposed.\n");
    }
  }

  if (!opts.yes) {
    if (!opts.json) process.stdout.write(`Dry-run. Re-run with --yes to write ${col.baseDir}/.api-resources.local.yaml.\n`);
    if (opts.json) printJson(jsonOk("api annotate apply", { ...summary, written: false }));
    return 0;
  }

  if (merge.changes.length === 0 && merge.conflicts.length === 0) {
    if (opts.json) printJson(jsonOk("api annotate apply", { ...summary, written: false }));
    return 0;
  }

  overlay.patches = merge.patches;
  await writeLocalOverlay(col.baseDir, overlay);
  await appendAuditLog(col.baseDir, {
    timestamp: new Date().toISOString(),
    kind: opts.kind,
    drafts: drafts.map((d) => d.audit),
    failures: errors,
  });
  if (!opts.json) printSuccess(`Wrote ${merge.changes.length} change(s) to ${col.baseDir}/.api-resources.local.yaml`);
  if (merge.conflicts.length > 0 && !opts.force && !opts.json) {
    printWarning(`${merge.conflicts.length} conflict(s) kept existing values. Re-run with --force to overwrite.`);
  }
  // ARV-217: after a successful apply, surface the basePaths the agent
  // should keep in `checks run --include` so a narrowed scope doesn't
  // silently skip the freshly annotated resources. Without this hint, the
  // next stateful run reports "no pagination config" for every endpoint
  // outside the include filter and the apply looks like a no-op.
  if (!opts.json && merge.changes.length > 0) {
    const annotatedBasePaths = new Set<string>();
    for (const patch of merge.patches) {
      const slice = slicesByName.get(patch.resource);
      if (slice?.basePath) annotatedBasePaths.add(slice.basePath);
    }
    if (annotatedBasePaths.size > 0) {
      const checkName = opts.kind === "pagination"
        ? "pagination_invariants"
        : opts.kind === "lifecycle"
          ? "lifecycle_transitions"
          : opts.kind === "idempotency"
            ? "idempotency_replay"
            : opts.kind === "readback"
              ? "cross_call_references"
              : opts.kind === "seed-bodies"
                ? "stateful"
                : "stateful";
      const includeAlt = [...annotatedBasePaths].map(escapeForPathRegex).join("|");
      process.stdout.write(
        `\nTip: to exercise these annotations, scope --include to cover the annotated basePath(s):\n` +
        `  zond checks run --api ${opts.api} --check ${checkName} --include 'path:^(${includeAlt})(/.*)?$'\n`,
      );
    }
  }
  if (opts.json) printJson(jsonOk("api annotate apply", { ...summary, written: true }));
  return 0;
}

function escapeForPathRegex(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseByKind(kind: SubcommandKind, parsed: unknown, slice: ResourceSlice): { patch: ResourcePatch; audit: Record<string, unknown> } {
  switch (kind) {
    case "seed-bodies": return seedBodies.parseSeedBodyResponse(parsed, slice);
    case "lifecycle":   return lifecycle.parseLifecycleResponse(parsed, slice);
    case "idempotency": return idempotency.parseIdempotencyResponse(parsed, slice);
    case "pagination":  return pagination.parsePaginationResponse(parsed, slice);
    case "readback":    return readback.parseReadbackResponse(parsed, slice);
    case "resources":   throw new Error("resources kind handled separately");
  }
}

async function applyResources(apiDir: string, documents: unknown[], opts: ApplyOptions): Promise<number> {
  if (documents.length !== 1) {
    printWarning(`Expected 1 YAML document with 'extensions:'; got ${documents.length}. Using the first.`);
  }
  let result;
  try { result = resourcesModule.parseResourcesResponse(documents[0]); }
  catch (err) { printError((err as Error).message); return 2; }

  if (!opts.json) {
    process.stdout.write(`Proposed: ${result.audit.proposed}; high-confidence accepted: ${result.extensions.length}; dropped: ${result.audit.droppedLowConfidence}\n`);
  }
  if (result.extensions.length === 0) {
    if (opts.json) printJson(jsonOk("api annotate apply", { written: false, accepted: 0 }));
    return 0;
  }

  const overlay = await readLocalOverlay(apiDir);
  const existing = (overlay.extensions ?? []);
  const existingNames = new Set(existing.map((e) => e.resource));
  const newOnes = result.extensions.filter((e) => !existingNames.has(e.resource));

  if (!opts.json) {
    process.stdout.write(`\nNew resource extension(s):\n`);
    for (const ext of newOnes) process.stdout.write(`  + ${ext.resource} (${ext.basePath})\n`);
  }

  if (!opts.yes) {
    if (!opts.json) process.stdout.write(`\nDry-run. Re-run with --yes to write.\n`);
    if (opts.json) printJson(jsonOk("api annotate apply", { written: false, accepted: newOnes.length }));
    return 0;
  }

  overlay.extensions = [...existing, ...newOnes];
  await writeLocalOverlay(apiDir, overlay);
  await appendAuditLog(apiDir, {
    timestamp: new Date().toISOString(),
    kind: "resources",
    accepted: newOnes.length,
    dropped: result.audit.droppedLowConfidence,
  });
  if (!opts.json) printSuccess(`Wrote ${newOnes.length} extension(s) to ${apiDir}/.api-resources.local.yaml`);
  if (opts.json) printJson(jsonOk("api annotate apply", { written: true, accepted: newOnes.length }));
  return 0;
}

// ─── Auto phase (ARV-262) ────────────────────────────────────────────

const AUTO_ASPECTS = ["pagination", "lifecycle", "idempotency", "seed-bodies"] as const;

export interface AutoOptions {
  api: string;
  aspects: auto.Aspect[];
  confidence: auto.Confidence;
  only?: string[];
  autoApply?: boolean;
  force?: boolean;
  json?: boolean;
  dbPath?: string;
  /** ARV-277: focused worklist mode. When set:
   *   - widens scope to `--confidence low` so every partial / fallback
   *     inference is captured;
   *   - filters to inferences with gaps or fallbacks (`confidence !==
   *     "high"`) — these are the resources the agent still needs to
   *     finish;
   *   - sorts by `downstream_endpoints_blocked` (descending) so the
   *     agent picks the biggest-blast-radius resource first;
   *   - prints a table (or JSON) instead of the usual diff.
   *   Mutually exclusive with `--auto-apply` — gap-report is read-only.
   */
  gapReport?: boolean;
}

export async function autoCommand(opts: AutoOptions): Promise<number> {
  const col = resolveApiCollection(opts.api, opts.dbPath);
  if ("error" in col) { printError(col.error); return 2; }
  if (!col.baseDir || !col.spec) {
    printError(`API '${opts.api}' has no spec/base_dir registered.`);
    return 2;
  }

  const doc = await readOpenApiSpec(col.spec);
  const map = await readResourceMap(col.baseDir);
  if (!map) {
    printError(`API '${opts.api}' has no .api-resources.yaml. Run \`zond refresh-api ${opts.api}\` first.`);
    return 2;
  }

  let resources = map.resources;
  if (opts.only && opts.only.length > 0) {
    const wanted = new Set(opts.only);
    resources = resources.filter((r) => wanted.has(r.resource));
  }
  const slices = buildResourceSlices(doc, resources);

  // ARV-270: load .env.yaml so seed-body inference can substitute
  // `{{customer}}` / `{{audience_id}}` templates for FK-shaped required
  // fields. Missing/unreadable file → empty env, heuristic still runs
  // but skips the FK lookup branch.
  const env = (await loadEnvFile(join(col.baseDir, ".env.yaml"))) ?? {};

  // ARV-277: gap-report mode widens scope to capture every partial /
  // fallback inference; the filter narrows to non-high entries below.
  const effectiveConfidence: auto.Confidence = opts.gapReport ? "low" : opts.confidence;
  const inferences = auto.inferAll(slices, opts.aspects, env)
    .filter((i) => auto.meetsConfidence(i.confidence, effectiveConfidence));

  if (opts.gapReport) {
    return renderGapReport(opts, col.baseDir, inferences, slices.length);
  }

  const patches = inferences.map((i) => i.patch);
  const overlay = await readLocalOverlay(col.baseDir);
  const existing = (overlay.patches ?? []) as ResourcePatch[];
  const merge = mergePatches(existing, patches, { force: opts.force === true });

  const perAspectCount: Record<string, number> = {};
  for (const i of inferences) perAspectCount[i.aspect] = (perAspectCount[i.aspect] ?? 0) + 1;

  const summary = {
    api: opts.api,
    aspects: opts.aspects,
    confidence: opts.confidence,
    resourcesScanned: slices.length,
    inferences: inferences.length,
    perAspect: perAspectCount,
    changes: merge.changes.length,
    conflicts: merge.conflicts.length,
  };

  const diff = renderChangesDiff(merge);
  if (!opts.json) {
    process.stdout.write(`Scanned ${slices.length} resource(s); produced ${inferences.length} ${opts.confidence}-confidence inference(s).\n`);
    for (const [aspect, count] of Object.entries(perAspectCount)) {
      process.stdout.write(`  ${aspect}: ${count}\n`);
    }
    if (diff) {
      process.stdout.write("\nProposed changes (and conflicts):\n");
      process.stdout.write(diff + "\n\n");
    } else if (inferences.length > 0) {
      process.stdout.write("No changes proposed — overlay already matches inferences.\n");
    }
  }

  if (!opts.autoApply) {
    if (!opts.json) process.stdout.write(`Dry-run. Re-run with --auto-apply to write ${col.baseDir}/.api-resources.local.yaml.\n`);
    if (opts.json) printJson(jsonOk("api annotate auto", { ...summary, written: false }));
    return 0;
  }

  if (merge.changes.length === 0 && merge.conflicts.length === 0) {
    if (opts.json) printJson(jsonOk("api annotate auto", { ...summary, written: false }));
    return 0;
  }

  overlay.patches = merge.patches;
  await writeLocalOverlay(col.baseDir, overlay);
  await appendAuditLog(col.baseDir, {
    timestamp: new Date().toISOString(),
    kind: "auto",
    aspects: opts.aspects,
    confidence: opts.confidence,
    inferences: inferences.map((i) => ({ resource: i.resource, aspect: i.aspect, confidence: i.confidence, rationale: i.rationale })),
  });
  if (!opts.json) printSuccess(`Wrote ${merge.changes.length} change(s) to ${col.baseDir}/.api-resources.local.yaml`);
  if (merge.conflicts.length > 0 && !opts.force && !opts.json) {
    printWarning(`${merge.conflicts.length} conflict(s) kept existing values. Re-run with --force to overwrite.`);
  }
  if (opts.json) printJson(jsonOk("api annotate auto", { ...summary, written: true }));
  return 0;
}

// ─── ARV-277: gap-report mode ────────────────────────────────────────

/**
 * Focused worklist for the agent that calls `annotate auto`. Filters
 * to inferences that the heuristic *can't* finish (gaps or generic
 * fallbacks) and ranks them by downstream impact — number of endpoints
 * blocked when this resource's FK var stays unfilled. Reads
 * `.api-fixtures.yaml` to find `affectedEndpoints[]` per FK var; if
 * the manifest is missing the count falls back to 0 (alphabetical sort
 * by resource name kicks in as tiebreaker).
 */
interface GapReportRow {
  resource: string;
  aspect: auto.Aspect;
  confidence: auto.Confidence;
  rationale: string;
  /** Approximate count of endpoints that depend on this resource's FK
   *  var being seedable (from `.api-fixtures.yaml`
   *  `affectedEndpoints[].length`). */
  downstream_endpoints_blocked: number;
}

async function renderGapReport(
  opts: AutoOptions,
  baseDir: string,
  inferences: auto.AutoInference[],
  scanned: number,
): Promise<number> {
  if (opts.autoApply) {
    printError("--gap-report is read-only; remove --auto-apply.");
    return 2;
  }
  const manifest = await readFixtureManifest(baseDir);
  const downstream = buildResourceDownstreamMap(manifest);
  // Keep only resources where the heuristic produced a partial answer
  // (gaps or generic fallback) — these are the ones the agent needs.
  // High-confidence inferences are already complete; emitting them in a
  // "worklist" would just be noise.
  const rows: GapReportRow[] = inferences
    .filter((i) => i.confidence !== "high")
    .map((i) => ({
      resource: i.resource,
      aspect: i.aspect,
      confidence: i.confidence,
      rationale: i.rationale,
      downstream_endpoints_blocked: downstream.get(i.resource) ?? 0,
    }))
    .sort((a, b) =>
      b.downstream_endpoints_blocked - a.downstream_endpoints_blocked
      || a.resource.localeCompare(b.resource),
    );

  if (opts.json) {
    printJson(jsonOk("api annotate auto --gap-report", {
      api: opts.api,
      aspects: opts.aspects,
      scanned,
      total_inferences: inferences.length,
      gap_rows: rows.length,
      worklist: rows,
    }));
    return 0;
  }

  process.stdout.write(`Scanned ${scanned} resource(s); ${inferences.length} inference(s); ${rows.length} need agent attention.\n\n`);
  if (rows.length === 0) {
    process.stdout.write("No gaps — heuristic produced high-confidence inferences for every applicable resource.\n");
    return 0;
  }
  const w = {
    resource: Math.max(8, ...rows.map((r) => r.resource.length)),
    aspect: Math.max(6, ...rows.map((r) => r.aspect.length)),
    conf: 6,
    blocked: 9,
  };
  process.stdout.write(
    `${pad("resource", w.resource)}  ${pad("aspect", w.aspect)}  ${pad("conf", w.conf)}  ${pad("blocked", w.blocked)}  rationale\n`,
  );
  process.stdout.write(
    `${"-".repeat(w.resource)}  ${"-".repeat(w.aspect)}  ${"-".repeat(w.conf)}  ${"-".repeat(w.blocked)}  ---------\n`,
  );
  for (const r of rows) {
    process.stdout.write(
      `${pad(r.resource, w.resource)}  ${pad(r.aspect, w.aspect)}  ${pad(r.confidence, w.conf)}  ${pad(String(r.downstream_endpoints_blocked), w.blocked)}  ${r.rationale}\n`,
    );
  }
  process.stdout.write(`\nNext: pipe each resource through \`zond api annotate dump --seed-bodies --only <name> --with-last-attempt\` for full context.\n`);
  return 0;
}

function buildResourceDownstreamMap(manifest: FixtureManifestYaml | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!manifest) return out;
  for (const entry of manifest.fixtures ?? []) {
    if (!entry.affectedEndpoints || entry.affectedEndpoints.length === 0) continue;
    // FK-vars are named after their owning resource singular (`customer`,
    // `account`, `webhook_endpoint`); resource names are plural-ish
    // (`customers`, `accounts`, `webhook_endpoints`). Map both
    // directions so the downstream count survives whichever spelling
    // the resource map ends up with.
    for (const candidate of resourceCandidates(entry.name)) {
      const prev = out.get(candidate) ?? 0;
      // Take the max — a resource may anchor several FK vars (e.g.
      // `customer` and `customer_id`); we surface the largest blast radius.
      if (entry.affectedEndpoints.length > prev) out.set(candidate, entry.affectedEndpoints.length);
    }
  }
  return out;
}

function resourceCandidates(varName: string): string[] {
  // Strip standard FK suffixes (kept in sync with auto.ts:FK_SUFFIX_RE).
  const stem = varName.replace(/(_id|_uuid|_slug|_key|_token|_ref)$/, "");
  // Common pluralizations (most resource names plural). `account` →
  // `accounts`, `webhook_endpoint` → `webhook_endpoints`, `category` →
  // `categories`. We don't reach for a full inflector — `+s` /`+es`
  // is enough for the FK-var → resource-name match rate we need.
  const candidates = new Set<string>([varName, stem]);
  if (/y$/.test(stem)) candidates.add(stem.replace(/y$/, "ies"));
  else if (/s$/.test(stem)) candidates.add(stem);
  else candidates.add(`${stem}s`);
  return Array.from(candidates);
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

// ─── I/O helpers ─────────────────────────────────────────────────────

async function readInput(source: string): Promise<string> {
  if (source === "-") return await readStdin();
  return await readFile(source, "utf-8");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

function parseYamlDocuments(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("- ")) {
    const parsed = Bun.YAML.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  }
  const segments = trimmed.split(/^---\s*$/m).map((s) => s.trim()).filter(Boolean);
  return segments.map((s) => Bun.YAML.parse(s));
}

async function appendAuditLog(apiDir: string, record: Record<string, unknown>): Promise<void> {
  const path = join(apiDir, ".api-resources.annotate.log.ndjson");
  if (!existsSync(apiDir)) await mkdir(apiDir, { recursive: true });
  await appendFile(path, JSON.stringify(record) + "\n", "utf-8");
}

void jsonError;

// ─── Commander registration ──────────────────────────────────────────

export function registerApiAnnotate(program: Command): void {
  const api = program
    .command("api")
    .description("Per-API tooling — annotate the .api-resources.local.yaml overlay (ARV-187)");

  const annotate = api
    .command("annotate")
    .description("Overlay authoring for .api-resources.local.yaml. Three subcommands: `dump` + `apply` (agent-in-the-loop, ARV-187) and `auto` (zond-only heuristic inference, ARV-262).");

  annotate
    .command("dump")
    .description("Emit per-resource spec slices + expected response shape on stdout (JSON). The agent decides how to prompt its LLM; zond carries no prompts.")
    .option("--api <name>", "Target API (else falls back to global --api)")
    .option("--seed-bodies", "Slices for seed_body{content_type, body}")
    .option("--lifecycle", "Slices + action-endpoint candidates for lifecycle")
    .option("--idempotency", "Slices for idempotency{header, scope, ...}")
    .option("--pagination", "Slices for pagination{type, cursor_param, ...}")
    .option("--readback", "Create+read pair for readback_diff")
    .option("--resources", "Orphan-endpoint list for resource-graph extensions")
    .option("--only <list>", "Comma-separated resource names — restrict scope", csv)
    .option("--with-last-attempt", "ARV-277: enrich seed-bodies bundles with the most recent fixture-kind POST attempt (`request_body`/`response_status`/`response_body`/`attempted_at`) so the agent sees what zond tried last without re-running prepare-fixtures.")
    .option("--db <path>", "SQLite db path override")
    .action(async (rawOpts, cmd: Command) => {
      const kind = pickKind(rawOpts);
      if (!kind) {
        printError("Pick one of --seed-bodies | --lifecycle | --idempotency | --pagination | --readback | --resources");
        process.exitCode = 2;
        return;
      }
      if (rawOpts.withLastAttempt === true && kind !== "seed-bodies") {
        printWarning("--with-last-attempt is only meaningful with --seed-bodies; ignored.");
      }
      const apiName = resolveApiArg(rawOpts, cmd);
      if (!apiName) { printError("No API selected."); process.exitCode = 2; return; }
      process.exitCode = await dumpCommand({
        api: apiName,
        kind,
        only: rawOpts.only,
        dbPath: rawOpts.db,
        json: globalJson(cmd),
        withLastAttempt: rawOpts.withLastAttempt === true,
      });
    });

  annotate
    .command("auto")
    .description("ARV-262/270: heuristic inference (pagination/lifecycle/idempotency/seed-bodies) without an agent. Scales to large APIs where hand-written overlays per resource are impractical.")
    .option("--api <name>", "Target API (else falls back to global --api)")
    .option("--aspect <name>", "pagination | lifecycle | idempotency | seed-bodies | all", "all")
    .option("--confidence <level>", "Minimum confidence: high (default), medium, low", "high")
    .option("--only <list>", "Comma-separated resource names — restrict scope", csv)
    .option("--auto-apply", "Write the inferred patches to disk (default: dry-run + diff)")
    .option("--force", "Overwrite existing field-level conflicts")
    .option("--gap-report", "ARV-277: read-only worklist mode. Lists resources where the heuristic couldn't finish (gaps / generic fallback), ranked by downstream endpoints blocked. For agent-loop callers picking what to flesh out by hand.")
    .option("--db <path>", "SQLite db path override")
    .action(async (rawOpts, cmd: Command) => {
      const apiName = resolveApiArg(rawOpts, cmd);
      if (!apiName) { printError("No API selected."); process.exitCode = 2; return; }
      const aspects = parseAspects(rawOpts.aspect);
      if (aspects.length === 0) {
        printError(`--aspect must be one of: ${[...AUTO_ASPECTS, "all"].join(", ")}`);
        process.exitCode = 2;
        return;
      }
      const confidence = rawOpts.confidence as auto.Confidence;
      if (!["high", "medium", "low"].includes(confidence)) {
        printError(`--confidence must be high|medium|low`);
        process.exitCode = 2;
        return;
      }
      process.exitCode = await autoCommand({
        api: apiName,
        aspects,
        confidence,
        only: rawOpts.only,
        autoApply: rawOpts.autoApply === true,
        force: rawOpts.force === true,
        gapReport: rawOpts.gapReport === true,
        dbPath: rawOpts.db,
        json: globalJson(cmd),
      });
    });

  annotate
    .command("apply")
    .description("Validate the agent's YAML responses, render a diff, and (with --yes) write into .api-resources.local.yaml.")
    .option("--api <name>", "Target API (else falls back to global --api)")
    .option("--seed-bodies", "Apply seed_body block")
    .option("--lifecycle", "Apply lifecycle block")
    .option("--idempotency", "Apply idempotency block")
    .option("--pagination", "Apply pagination block")
    .option("--readback", "Apply readback_diff block")
    .option("--resources", "Apply orphan-resource extension list")
    .option("--input <file>", "Path to the YAML responses file, or `-` for stdin", "-")
    .option("--yes", "Write the proposed patches to disk (default: dry-run + diff)")
    .option("--force", "Overwrite the existing value on field-level conflict")
    .option("--db <path>", "SQLite db path override")
    .action(async (rawOpts, cmd: Command) => {
      const kind = pickKind(rawOpts);
      if (!kind) {
        printError("Pick one of --seed-bodies | --lifecycle | --idempotency | --pagination | --readback | --resources");
        process.exitCode = 2;
        return;
      }
      const apiName = resolveApiArg(rawOpts, cmd);
      if (!apiName) { printError("No API selected."); process.exitCode = 2; return; }
      process.exitCode = await applyCommand({
        api: apiName,
        kind,
        input: rawOpts.input ?? "-",
        yes: rawOpts.yes === true,
        force: rawOpts.force === true,
        dbPath: rawOpts.db,
        json: globalJson(cmd),
      });
    });
}

function pickKind(opts: Record<string, unknown>): SubcommandKind | null {
  const flags: Array<[string, SubcommandKind]> = [
    ["seedBodies", "seed-bodies"],
    ["lifecycle", "lifecycle"],
    ["idempotency", "idempotency"],
    ["pagination", "pagination"],
    ["readback", "readback"],
    ["resources", "resources"],
  ];
  const set = flags.filter(([f]) => opts[f] === true);
  if (set.length !== 1) return null;
  return set[0]![1];
}

function csv(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseAspects(raw: unknown): auto.Aspect[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  if (raw === "all") return [...AUTO_ASPECTS];
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const valid: auto.Aspect[] = [];
  for (const p of parts) {
    if ((AUTO_ASPECTS as readonly string[]).includes(p)) valid.push(p as auto.Aspect);
    else return [];
  }
  return valid;
}

function resolveApiArg(rawOpts: Record<string, unknown>, cmd: Command): string | null {
  const fromFlag = rawOpts.api;
  if (typeof fromFlag === "string" && fromFlag.length > 0) return fromFlag;
  const fromParent = cmd.parent?.parent?.parent?.opts().api;
  if (typeof fromParent === "string" && fromParent.length > 0) return fromParent;
  const fromEnv = process.env.ZOND_API_GLOBAL;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return null;
}

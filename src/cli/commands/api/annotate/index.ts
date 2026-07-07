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
import { readResourceMap, type ResourceYaml } from "../../discover.ts";
import { buildResourceSlices, type ResourceSlice, type EndpointDump } from "./prompts.ts";
import { readLocalOverlay, writeLocalOverlay, mergePatches, renderChangesDiff, type ResourcePatch } from "./overlay.ts";
import * as seedBodies from "./seed-bodies.ts";
import * as lifecycle from "./lifecycle.ts";
import * as idempotency from "./idempotency.ts";
import * as pagination from "./pagination.ts";
import * as readback from "./readback.ts";
import * as resourcesModule from "./resources.ts";
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
  /** ARV-278: when `withLastAttempt` is true, return the most recent N
   *  attempts (most recent first) instead of just the last one. Surfaces
   *  the *progression* of errors as the overlay was iterated — first 400
   *  was "missing X", after fixing the body the next 400 is "stale FK"
   *  pulls cascade-staleness (ARV-282) onto the agent's screen one
   *  iteration earlier. `1` keeps the old single-snapshot behaviour. */
  historyLimit?: number;
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
      // ARV-330: use the wider all-run-kinds query (a create-path POST made
      // during a check/probe run counts too, not just fixture runs) and pass
      // the child-exclude pattern so probe sub-resource POSTs
      // (`/v1/accounts/{id}/reject`) don't monopolise the history window.
      const { getRecentCreatePosts } = await import("../../../../db/queries/results.ts");
      const limit = Math.max(1, Math.floor(opts.historyLimit ?? 1));
      for (const b of bundles) {
        const data = b.data as Record<string, unknown> | null;
        const endpoints = data?.endpoints as Record<string, EndpointDump | undefined> | undefined;
        const create = endpoints?.create;
        if (!create) continue;
        const pattern = createUrlLikePattern(create.path);
        const recent = getRecentCreatePosts(pattern, limit, childExcludePattern(create.path));
        if (recent.length === 0) continue;
        // ARV-278: keep `last_attempt` as the most-recent entry (back-compat
        // with single-snapshot consumers) and add `attempt_history` when
        // the caller asked for >1.
        (b.data as Record<string, unknown>).last_attempt = recent[0];
        if (limit > 1) (b.data as Record<string, unknown>).attempt_history = recent;
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

/**
 * ARV-330: companion NOT-LIKE pattern that excludes child sub-resource
 * POSTs (`/v1/accounts/{id}/reject`, `.../persons`) from a create-path
 * match. Pairs with `createUrlLikePattern` in `getRecentCreatePosts`.
 */
export function childExcludePattern(createPath: string): string {
  const collapsed = createPath.replace(/\{[^}]+\}/g, "%");
  return `%${collapsed}/%`;
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
  /** ARV-281: agent-loop regression protection. When set, apply drops
   *  any aspect-level field on a proposed patch when the existing
   *  overlay already has that field set (regardless of value). The
   *  agent's response can only ADD missing pieces — it can't overwrite
   *  a previously curated `seed_body` even by accident. `--force`
   *  ignores this flag (explicit override stays explicit). */
  gapFillOnly?: boolean;
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

  // ARV-281: gap-fill-only — drop aspect-level fields where the existing
  // overlay already has a value set. Keeps the agent's response strictly
  // additive vs. previous (heuristic + curated) edits. `--force` opts out
  // of this guard, mirroring the existing conflict semantics.
  const filteredPatches = opts.gapFillOnly && opts.force !== true
    ? nonEmpty.map((d) => filterToGaps(d.patch, existing))
    : nonEmpty.map((d) => d.patch);
  const gapDroppedFields = opts.gapFillOnly && opts.force !== true
    ? countGapDroppedFields(nonEmpty.map((d) => d.patch), filteredPatches)
    : 0;

  const merge = mergePatches(existing, filteredPatches, { force: opts.force === true });

  const summary = {
    api: opts.api,
    kind: opts.kind,
    inputDocuments: documents.length,
    accepted: nonEmpty.length,
    dropped: drafts.length - nonEmpty.length,
    failures: errors,
    changes: merge.changes.length,
    conflicts: merge.conflicts.length,
    /** ARV-281: aspect-level fields the agent proposed that gap-fill-only
     *  silently dropped because the existing overlay already had them
     *  set. Distinct from `conflicts` which is mergePatches's concept of
     *  field-level disagreement. */
    gap_fill_dropped: gapDroppedFields,
  };

  const diff = renderChangesDiff(merge);
  if (!opts.json) {
    if (errors.length > 0) {
      printWarning(`Failed to parse ${errors.length} document(s):`);
      for (const e of errors) process.stdout.write(`  ✗ ${e.resource}: ${e.error}\n`);
    }
    if (gapDroppedFields > 0) {
      printWarning(`--gap-fill-only dropped ${gapDroppedFields} aspect-field(s) the agent proposed for resources that already had them set. Re-run with --force to overwrite anyway.`);
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

/**
 * ARV-280: error-message shapes Stripe/etc emit when an account-level
 * capability is missing rather than an overlay-level data issue.
 * Conservative — we only tag a resource as `account_capability_missing`
 * when the most recent attempts ALL match, because Stripe's
 * order-of-validation can surface a transient data error first and
 * then a capability error after the overlay is fixed.
 */
const HARD_BLOCKED_PATTERNS = [
  /not\s+supported\s+for\s+country/i,
  /not\s+available\s+in\s+your\s+account/i,
  /capability/i,
  /not\s+enabled/i,
  /\bnot\s+onboarded\b/i,
  /raw[- ]card[- ]data\s+(api|access)/i,
  /you do not have access/i,
  /signed up for connect/i,
];

/**
 * ARV-330: replies from security/auth probes that POST with deliberately
 * broken credentials. Their 401/403s say nothing about whether the
 * resource is capability-blocked, so the classifier drops them before
 * judging.
 */
const AUTH_NOISE_PATTERNS = [
  /invalid api key/i,
  /did not provide an api key/i,
  /no api key provided/i,
  /provided key '/i,
];

/**
 * ARV-330: verdict on a resource's create-path POST history. Pure so it
 * can be unit-tested without a DB. Returns `account_capability_missing`
 * when the account-level gate is the blocker, else null.
 *
 * Logic:
 *  1. Drop auth-probe noise (broken-cred 401/403s) — not about the resource.
 *  2. Any 2xx among valid attempts → the resource IS seedable, never blocked.
 *  3. A capability/onboarding gate is account-level and deterministic: one
 *     hit on a valid-key attempt (with no success) is enough. We don't
 *     require ALL attempts to match, because a generic-generator body can
 *     trigger a data-shaped 400 on one attempt while a leaner body hits
 *     the gate on another (the ARV-330 chicken-and-egg case).
 */
/**
 * ARV-330: guard the loose `createUrlLikePattern` LIKE from counting
 * child sub-resource POSTs. `%/v1/accounts%` also matches
 * `/v1/accounts/{id}/reject` and `.../persons` — POSTs to *different*
 * endpoints (often auth-probe noise) that would drown out the real
 * create-path attempt. Match the recorded URL's path segment-for-segment
 * against the create-path (`{param}` matches any single segment).
 */
export function urlMatchesCreatePath(requestUrl: string, createPath: string): boolean {
  let path: string;
  try { path = new URL(requestUrl).pathname; } catch { return false; }
  const want = createPath.split("/").filter(Boolean);
  const got = path.split("/").filter(Boolean);
  if (want.length !== got.length) return false;
  return want.every((seg, i) => seg.startsWith("{") || seg === got[i]);
}

export function classifyAttempts(
  attempts: Array<{ response_status: number | null; response_body: string | null }>,
): "account_capability_missing" | null {
  const valid = attempts.filter((a) => {
    if (a.response_status === 401 || a.response_status === 403) return false;
    const msg = extractMessage(a.response_body);
    return !(msg !== null && AUTH_NOISE_PATTERNS.some((re) => re.test(msg)));
  });
  if (valid.length === 0) return null;
  if (valid.some((a) => a.response_status !== null && a.response_status >= 200 && a.response_status < 300)) return null;
  const capabilityHit = valid.some((a) => {
    const msg = extractMessage(a.response_body);
    return msg !== null && HARD_BLOCKED_PATTERNS.some((re) => re.test(msg));
  });
  return capabilityHit ? "account_capability_missing" : null;
}

function extractMessage(body: string | null): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    const m = parsed?.error?.message;
    return typeof m === "string" ? m : null;
  } catch {
    return null;
  }
}

// ─── ARV-281: gap-fill filtering ─────────────────────────────────────

/**
 * Drop aspect-level fields on a proposed patch when the existing
 * overlay (matched by resource name) already has that field set to a
 * non-empty value. Returns a new patch object — never mutates input.
 */
export function filterToGaps(
  proposed: ResourcePatch,
  existing: ResourcePatch[],
): ResourcePatch {
  const prior = existing.find((p) => p.resource === proposed.resource);
  if (!prior) return proposed;
  const out: ResourcePatch = { resource: proposed.resource };
  for (const [key, value] of Object.entries(proposed) as Array<[string, unknown]>) {
    if (key === "resource") continue;
    const existingVal = (prior as unknown as Record<string, unknown>)[key];
    if (isPresent(existingVal)) continue; // already-set field → skip
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

function isPresent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).length > 0;
  return true;
}

function countGapDroppedFields(
  before: ResourcePatch[],
  after: ResourcePatch[],
): number {
  let n = 0;
  for (let i = 0; i < before.length; i++) {
    const b = before[i]!;
    const a = after[i]!;
    for (const k of Object.keys(b)) {
      if (k === "resource") continue;
      if (!(k in a)) n++;
    }
  }
  return n;
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
    .description("Overlay authoring for .api-resources.local.yaml. Two subcommands: `dump` (emit spec slices) + `apply` (validate & merge the agent's YAML) — agent-in-the-loop, ARV-187. zond carries no inference; the agent writes the annotations, zond validates and merges.");

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
    .option("--history <N>", "ARV-278: with --with-last-attempt, return the most recent N attempts (newest first) under `attempt_history`. Surfaces error progression as the overlay was iterated.", (v) => Number.parseInt(v, 10))
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
        historyLimit: Number.isFinite(rawOpts.history) ? rawOpts.history : undefined,
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
    .option("--gap-fill-only", "ARV-281: drop aspect-level fields the agent proposed for resources that already have that field set in the overlay. Keeps the agent's response strictly additive — protects curated `seed_body` blocks from accidental regression. Bypassed by --force.")
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
        gapFillOnly: rawOpts.gapFillOnly === true,
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

function resolveApiArg(rawOpts: Record<string, unknown>, cmd: Command): string | null {
  const fromFlag = rawOpts.api;
  if (typeof fromFlag === "string" && fromFlag.length > 0) return fromFlag;
  const fromParent = cmd.parent?.parent?.parent?.opts().api;
  if (typeof fromParent === "string" && fromParent.length > 0) return fromParent;
  const fromEnv = process.env.ZOND_API_GLOBAL;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return null;
}

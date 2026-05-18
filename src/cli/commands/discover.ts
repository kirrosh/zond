/**
 * `zond discover` — auto-fill `.env.yaml` from list-endpoints (TASK-136).
 *
 * Phase 2.5 of the audit flow used to be manual: `zond request GET /audiences`,
 * pluck the slug, paste into `.env.yaml`, repeat for every FK. ~15 min per
 * API. This command walks the resource map (`.api-resources.yaml`), hits
 * every owner-resource list-endpoint with the user's auth token, extracts
 * the first id, and proposes a diff. By default dry-run; `--apply` writes
 * with a `.env.yaml.bak` backup.
 *
 * Scope (v1):
 *  - Only list-endpoints with no path-params (collection-level GETs).
 *  - Only FK vars whose owner is identified in `.api-resources.yaml`.
 *  - Skips vars already present in `.env.yaml` unless their value is empty
 *    or a `# TODO` placeholder.
 */
import { join } from "path";
import { copyFile } from "fs/promises";
import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
} from "../../core/generator/index.ts";
import { loadEnvFile } from "../../core/parser/variables.ts";
import {
  composeSpec,
  type ComposedSpec,
  type SpecLayer,
} from "../../core/spec/layers.ts";
import { liveAuthHeaders } from "../../core/probe/shared.ts";
import { executeRequest } from "../../core/runner/http-client.ts";

/**
 * Suffix-aware field extraction. For var `project_slug` we prefer the
 * response's `slug` field over `id`; for `team_uuid` we prefer `uuid`.
 * This matches the user's intent expressed in the env-var name and avoids
 * the surprise where every nested resource gets the same generic `id` even
 * when the path-param clearly wants a slug.
 */
const VAR_SUFFIX_HINTS: Array<{ suffix: string; field: string }> = [
  { suffix: "_slug", field: "slug" },
  { suffix: "_uuid", field: "uuid" },
  { suffix: "_key", field: "key" },
  { suffix: "_version", field: "version" },
  { suffix: "_name", field: "name" },
  { suffix: "_code", field: "code" },
  { suffix: "_id", field: "id" },
];

function preferredFieldFromVar(varName: string): string {
  for (const { suffix, field } of VAR_SUFFIX_HINTS) {
    if (varName.endsWith(suffix)) return field;
  }
  return "id";
}

/** Strip a trailing FK-shape suffix (`_id`, `Id`, `_uuid`, `_slug`, `_name`,
 *  `_code`) from a var name and return the stem. Used by ARV-69 to find an
 *  owner resource when the resource map doesn't link the var to a list
 *  endpoint explicitly (common-style {id} placeholders).
 */
function stemFromVarName(varName: string): string | null {
  const lower = varName.toLowerCase();
  for (const suffix of ["_id", "_uuid", "_slug", "_name", "_code"]) {
    if (lower.endsWith(suffix)) return lower.slice(0, -suffix.length);
  }
  // CamelCase: `domainId` → `domain`.
  const m = varName.match(/^(.+?)(Id|Uuid)$/);
  if (m) return m[1]!.toLowerCase();
  return null;
}

/** ARV-69 (feedback round-02 / F10): try to find a resource whose
 *  list endpoint is a plausible source for `varName` based on the var's
 *  name stem. Matches singular ↔ plural and is case-insensitive. Returns
 *  the FkTarget on hit, undefined on miss.
 */
export function inferOwnerFromVarName(
  varName: string,
  map: ApiResourceMapYaml,
): FkTarget | undefined {
  const stem = stemFromVarName(varName);
  if (!stem) return undefined;
  const candidates = new Set([stem, `${stem}s`, stem.endsWith("s") ? stem.slice(0, -1) : stem]);
  for (const r of map.resources) {
    if (!r.endpoints?.list) continue;
    const lower = r.resource.toLowerCase();
    if (candidates.has(lower)) {
      return { varName, ownerResource: r.resource, listLabel: r.endpoints.list };
    }
  }
  return undefined;
}

function pickFieldFromObject(item: unknown, preferred: string): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const obj = item as Record<string, unknown>;
  const tryKey = (k: string): string | undefined => {
    if (k in obj) {
      const v = obj[k];
      if (typeof v === "string" || typeof v === "number") return String(v);
    }
    return undefined;
  };
  return (
    tryKey(preferred) ??
    tryKey("id") ??
    tryKey("slug") ??
    tryKey("uuid") ??
    tryKey("key") ??
    tryKey("name")
  );
}

/** Walk the response body for the first item matching common SaaS list shapes,
 *  then pick a field hint-aware. */
function extractFirstField(body: unknown, preferred: string): string | undefined {
  if (Array.isArray(body)) return pickFieldFromObject(body[0], preferred);
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const key of ["data", "items", "results", "records"]) {
      const arr = obj[key];
      if (Array.isArray(arr) && arr.length > 0) {
        return pickFieldFromObject(arr[0], preferred);
      }
    }
  }
  return undefined;
}

/** True when the list-response is well-shaped but contains zero items.
 *  Used to distinguish "no <entity> in target API yet — go create one"
 *  from "response shape unrecognized" (TASK-273). */
export function isEmptyListBody(body: unknown): boolean {
  if (Array.isArray(body)) return body.length === 0;
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const key of ["data", "items", "results", "records"]) {
      if (key in obj) {
        const arr = obj[key];
        return Array.isArray(arr) && arr.length === 0;
      }
    }
  }
  return false;
}
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { getSecretRegistry } from "../../core/secrets/registry.ts";
import type { EndpointInfo, SecuritySchemeInfo } from "../../core/generator/types.ts";
import type { RecommendedAction } from "../../core/diagnostics/failure-hints.ts";

export interface DiscoverOptions {
  specPath: string;
  /** Path to `apis/<name>/` — used to read .api-resources.yaml and write .env.yaml. */
  apiDir: string;
  /** Default `apis/<name>/.env.yaml`. */
  envPath?: string;
  apply?: boolean;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
  json?: boolean;
  /** TASK-281: GET each fixture's read-by-id endpoint to classify live/stale/
   *  unknown. Without `--apply` this is a read-only report; with `--apply` (or
   *  the `--refresh` shortcut) stale fixtures are unset and re-resolved
   *  through the normal discover flow. */
  verify?: boolean;
  /** ARV-205/F19 (R10/R13/R14): command name surfaced in the JSON envelope.
   *  prepare-fixtures delegates here for the single-pass path; the envelope
   *  should reflect the user-facing command, not the internal "discover". */
  commandName?: string;
}

export interface FkTarget {
  /** Env var name to fill (e.g. `audience_id`). */
  varName: string;
  /** Resource that owns the id (e.g. `audiences`). */
  ownerResource: string;
  /** List endpoint label, e.g. `GET /audiences`. */
  listLabel: string;
}

export interface DiscoveryItem {
  varName: string;
  resource: string;
  listPath: string;
  /** What was found, if anything. */
  discovered?: string;
  /** What's currently in env (may be empty/placeholder). */
  current?: string;
  /** Action to take: write, skip-already-set, miss-no-list, miss-network, miss-status, miss-empty, miss-no-id. */
  status:
    | "write"
    | "skip-already-set"
    | "skip-already-equal"
    | "skip-not-required"
    | "miss-no-list"
    | "miss-nested-list"
    | "miss-no-owner"
    | "miss-network"
    | "miss-status"
    | "miss-empty"
    | "miss-no-id"
    // TASK-281 verify-mode states
    | "verify-live"
    | "verify-stale"
    | "verify-unknown"
    | "verify-no-read"
    | "verify-skip-empty"
    // ARV-143: filled var classified as trusted user input — manifest source
    // is user-config (auth/server/header) or there's no read-by-id endpoint
    // for its resource. Refresh has no verification path, so we mark it as
    // such instead of silently omitting (the doctor view that says set:true).
    | "verify-user-config";
  /** ARV-46: manifest-grade status enum projected onto agent-readable
   *  envelope. Filled when discover ran in manifest-driven mode.
   *  filled | failed:no-list-endpoint | failed:list-empty | failed:miss-network
   *  | skipped:already-set | skipped:not-required */
  manifestStatus?: ManifestStatus;
  /** ARV-46: source classification copied from `.api-fixtures.yaml`. */
  manifestSource?: FixtureManifestEntry["source"];
  reason?: string;
  /** TASK-294: agent-routable action for items the user must fix.
   *  miss-* / verify-stale / verify-unknown → `fix_fixture`.
   *  miss-network → `fix_network_config`.
   *  write / skip-* / verify-live → undefined. */
  recommended_action?: RecommendedAction;
  /** ARV-142: when --refresh re-resolves a verify-stale item, the original
   *  verify-stale entry is replaced with the refresh outcome. This flag
   *  preserves the "was stale before refresh" signal so summary can
   *  report stale_fixed vs still_stale honestly. */
  wasStale?: boolean;
}

/** TASK-294: derive recommended_action from a DiscoveryItem's status. */
export function discoveryAction(status: DiscoveryItem["status"]): RecommendedAction | undefined {
  if (status === "miss-network") return "fix_network_config";
  if (status.startsWith("miss-") || status === "verify-stale" || status === "verify-unknown") {
    return "fix_fixture";
  }
  return undefined;
}

/** ARV-46: stable manifest-grade status enum for agent consumers. The CLI
 *  prints this column when discover runs in manifest-driven mode and it's
 *  exposed verbatim in the JSON envelope. */
export type ManifestStatus =
  | "filled"
  | "failed:no-list-endpoint"
  | "failed:list-empty"
  | "failed:miss-network"
  | "skipped:already-set"
  | "skipped:not-required";

export function toManifestStatus(status: DiscoveryItem["status"]): ManifestStatus {
  switch (status) {
    case "write":
      return "filled";
    case "skip-already-set":
    case "skip-already-equal":
      return "skipped:already-set";
    case "skip-not-required":
      return "skipped:not-required";
    case "miss-network":
      return "failed:miss-network";
    case "miss-empty":
      return "failed:list-empty";
    // miss-no-list / miss-nested-list / miss-no-owner / miss-status / miss-no-id —
    // the underlying cause is "we have no usable list endpoint to read from", so
    // they collapse onto the same manifest-level bucket.
    default:
      return "failed:no-list-endpoint";
  }
}

export function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (trimmed === "") return true;
  // `var: ""  # TODO: fill in` lands as "" after YAML parse.
  if (/^TODO/i.test(trimmed)) return true;
  return false;
}

function parseEndpointLabel(label: string): { method: string; path: string } | null {
  const parts = label.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return { method: parts[0]!.toUpperCase(), path: parts[1]! };
}

export interface ResourceYaml {
  resource: string;
  basePath: string;
  itemPath: string;
  idParam: string;
  captureField?: string;
  hasFullCrud?: boolean;
  endpoints: { list?: string; create?: string; read?: string; update?: string; delete?: string };
  fkDependencies: Array<{ var: string; param: string; in: "path" | "body"; ownerResource: string | null }>;
  /** ARV-169: optional POST→GET drift overrides. snake_case to match
   *  yaml on disk; loaders preserve as-is so the check can read it. */
  readback_diff?: {
    ignore_fields?: string[];
    write_to_read_map?: Record<string, string>;
  };
  /** ARV-170: opt-in idempotency-replay probe for this resource's
   *  create endpoint. */
  idempotency?: {
    header?: string;
    scope?: "endpoint" | "global";
    ignore_response_fields?: string[];
  };
  /** ARV-171: pagination-invariants probe for this resource's list
   *  endpoint. */
  pagination?: {
    type?: "cursor" | "page" | "offset" | "token";
    cursor_param?: string;
    cursor_field?: string;
    has_more_field?: string;
    limit_param?: string;
    default_limit?: number;
    items_field?: string;
    page_param?: string;
    start_page?: number;
  };
  /** ARV-172: per-resource state machine + action endpoints. */
  lifecycle?: {
    field: string;
    states: string[];
    transitions: Array<{ from: string; to: string[] }>;
    actions: Record<string, {
      endpoint: string;
      expected_state: string;
      body?: Record<string, unknown>;
    }>;
  };
  /** ARV-187: LLM-authored example POST body for stateful checks that
   *  need a valid create payload. When present, stateful CRUD checks
   *  (cross_call_references, idempotency_replay, lifecycle_transitions,
   *  ensure_resource_availability, use_after_free) prefer this over
   *  `generateFromSchema(create.requestBodySchema)`. The fallback path
   *  stays — yaml is purely additive. `content_type` defaults to the
   *  create endpoint's `requestBodyContentType`. */
  seed_body?: {
    content_type?: string;
    body: Record<string, unknown>;
  };
}

export interface ApiResourceMapYaml {
  resources: ResourceYaml[];
}

/** ARV-122 layer ids — exported so downstream code (doctor, future
 *  catalog --provenance) can compare against the provenance map
 *  without re-typing the strings. */
export const RESOURCE_LAYER_UPSTREAM = "upstream";
export const RESOURCE_LAYER_EXTENSION = "extension";

/** ARV-122: build the two-layer SpecLayer set for an API's resource
 *  map. Kept here (and not in `core/spec/layers.ts`) so the YAML
 *  loaders stay co-located with the schema types they parse. */
function buildResourceLayers(apiDir: string): SpecLayer<ResourceYaml>[] {
  return [
    {
      id: RESOURCE_LAYER_UPSTREAM,
      path: join(apiDir, ".api-resources.yaml"),
      precedence: 10,
      scope: "resources",
      mergePolicy: "override",
      load: async () => {
        const file = Bun.file(join(apiDir, ".api-resources.yaml"));
        if (!(await file.exists())) return [];
        const parsed = Bun.YAML.parse(await file.text());
        if (!parsed || typeof parsed !== "object") return [];
        return (parsed as { resources?: ResourceYaml[] }).resources ?? [];
      },
    },
    {
      id: RESOURCE_LAYER_EXTENSION,
      path: join(apiDir, ".api-resources.local.yaml"),
      precedence: 20,
      scope: "resources",
      mergePolicy: "override",
      load: () => readResourceExtensions(apiDir),
    },
  ];
}

/** ARV-122: compose the resource map through the SpecLayer pipeline,
 *  exposing the provenance map for callers that need to know which
 *  layer contributed a given resource (doctor diagnostics, m-18 CLI
 *  surface). `readResourceMap` keeps the legacy shape for callers
 *  that don't care. */
export async function composeResourceMap(
  apiDir: string,
): Promise<ComposedSpec<ResourceYaml>> {
  return composeSpec(buildResourceLayers(apiDir), (r) => r.resource);
}

export async function readResourceMap(apiDir: string): Promise<ApiResourceMapYaml | null> {
  // Old contract: return null when the upstream `.api-resources.yaml`
  // is missing (callers branch on this to surface a setup error). The
  // SpecLayer pipeline returns an empty list in that case, so check
  // existence explicitly to preserve behaviour.
  const upstream = Bun.file(join(apiDir, ".api-resources.yaml"));
  if (!(await upstream.exists())) return null;

  // ARV-122: route the merge through composeSpec. Behaviour is
  // identical to the previous ad-hoc Map merge — extension wins on
  // name collision (precedence 20 > 10, mergePolicy: "override") —
  // and the same path also feeds provenance into composeResourceMap.
  const composed = await composeResourceMap(apiDir);
  // ARV-169: field-level overlay for adding readback_diff / idempotency
  // / pagination / lifecycle without re-declaring the whole entry.
  const patches = await readResourcePatches(apiDir);
  return { resources: applyResourcePatches(composed.entries, patches) };
}

/** ARV-111: read `apis/<name>/.api-resources.local.yaml`. Same `resources:`
 *  shape as the main file (top-level `extensions:` key is the only
 *  difference, so the user can recognise it as a sibling). Returns [] when
 *  missing or empty so the merge path stays simple. */
export async function readResourceExtensions(apiDir: string): Promise<ResourceYaml[]> {
  const path = join(apiDir, ".api-resources.local.yaml");
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  const text = await file.text();
  const parsed = Bun.YAML.parse(text);
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as { extensions?: ResourceYaml[] };
  return obj.extensions ?? [];
}

/** ARV-169 (m-20): partial overlay for adding fields (readback_diff,
 *  future idempotency / pagination / lifecycle) to an existing
 *  resource entry without re-declaring its CRUD wiring. Lives in the
 *  same `.api-resources.local.yaml` under top-level `patches:`. Each
 *  entry MUST carry `resource:` (the merge key); any other declared
 *  field overlays the upstream value, leaving omitted fields intact.
 *
 *  Unlike `extensions:` (full replacement, ARV-111) this is field-
 *  level merge. Both can coexist in the same file. Returns [] when
 *  the file is missing or carries no `patches:` key. */
export async function readResourcePatches(apiDir: string): Promise<Array<Partial<ResourceYaml> & { resource: string }>> {
  const path = join(apiDir, ".api-resources.local.yaml");
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  const text = await file.text();
  const parsed = Bun.YAML.parse(text);
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as { patches?: Array<Partial<ResourceYaml> & { resource?: string }> };
  const raw = obj.patches ?? [];
  return raw.filter((p): p is Partial<ResourceYaml> & { resource: string } =>
    typeof p?.resource === "string" && p.resource.length > 0,
  );
}

/** ARV-169: apply partial patches over a composed resource list.
 *  Patch fields overwrite matching upstream fields; absent fields
 *  are preserved. Patches whose `resource` doesn't match anything
 *  upstream are dropped silently — callers wanting to ADD a whole
 *  resource use `extensions:` instead. */
function applyResourcePatches(
  resources: ResourceYaml[],
  patches: Array<Partial<ResourceYaml> & { resource: string }>,
): ResourceYaml[] {
  if (patches.length === 0) return resources;
  const byName = new Map(resources.map((r) => [r.resource, r] as const));
  for (const p of patches) {
    const upstream = byName.get(p.resource);
    if (!upstream) continue;
    byName.set(p.resource, { ...upstream, ...p });
  }
  return resources.map((r) => byName.get(r.resource) ?? r);
}

export interface FixtureManifestEntry {
  name: string;
  source: "auth" | "server" | "path" | "header" | "body-fk" | "capture-chain";
  required: boolean;
  description?: string;
  defaultValue?: string;
  affectedEndpoints?: string[];
}

export interface FixtureManifestYaml {
  fixtures: FixtureManifestEntry[];
}

/** Read `.api-fixtures.yaml`. Returns null when missing — caller falls back
 *  to the legacy resource-map-driven path. */
export async function readFixtureManifest(apiDir: string): Promise<FixtureManifestYaml | null> {
  const path = join(apiDir, ".api-fixtures.yaml");
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const text = await file.text();
  const parsed = Bun.YAML.parse(text);
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as { fixtures?: FixtureManifestEntry[] };
  return { fixtures: obj.fixtures ?? [] };
}

/** Build the unique target list from FK deps. Each FK var = one discovery
 *  attempt (we hit the owner's list endpoint once and reuse the result).
 *
 *  ARV-133: also include each resource's own idParam (when it has a list
 *  endpoint) — these are root-level required path-params with no fkDep edge
 *  to another resource, but they're trivially harvestable from the resource's
 *  own list endpoint. Without this, cascade silently skipped vars like
 *  `domain_id`, `webhook_id`, `template_id` even though `/domains`,
 *  `/webhooks`, `/templates` returned live data. Optional `manifest`
 *  parameter wires manifest-required path/body-fk vars onto a list endpoint
 *  via `inferOwnerFromVarName` (singular ↔ plural matching) so vars whose
 *  name doesn't appear in the resource map's idParam table still get
 *  attempted. */
export function collectTargets(
  map: ApiResourceMapYaml,
  manifest?: FixtureManifestYaml,
): FkTarget[] {
  const seen = new Set<string>();
  const out: FkTarget[] = [];
  const push = (t: FkTarget): void => {
    if (seen.has(t.varName)) return;
    seen.add(t.varName);
    out.push(t);
  };

  // 1. fkDeps — parent-id edges declared by resource-builder.
  for (const r of map.resources) {
    for (const dep of r.fkDependencies ?? []) {
      if (dep.in !== "path") continue;
      if (!dep.ownerResource) continue;
      const owner = map.resources.find(x => x.resource === dep.ownerResource);
      const listLabel = owner?.endpoints.list ?? "";
      push({ varName: dep.var, ownerResource: dep.ownerResource, listLabel });
    }
  }

  // 2. Each resource's own idParam → its own list endpoint. resource-builder's
  //    collectPathFkDeps skips this case (it emits only *parent* FKs), so
  //    without an explicit pass `domain_id`/`webhook_id`/etc. drop out of
  //    cascade entirely.
  for (const r of map.resources) {
    if (!r.idParam) continue;
    if (!r.endpoints?.list) continue;
    push({ varName: r.idParam, ownerResource: r.resource, listLabel: r.endpoints.list });
  }

  // 3. Manifest-required vars (path / body-fk) whose name doesn't match any
  //    fkDep edge or resource idParam. Use singular↔plural stemming to find
  //    an owner — same logic as the discover-via-manifest path uses (ARV-69).
  if (manifest) {
    for (const entry of manifest.fixtures) {
      if (!entry.required) continue;
      if (entry.source !== "path" && entry.source !== "body-fk") continue;
      if (seen.has(entry.name)) continue;
      const inferred = inferOwnerFromVarName(entry.name, map);
      if (inferred) push(inferred);
    }
  }

  return out;
}

export async function probeOne(
  target: FkTarget,
  current: string | undefined,
  endpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
  baseUrl: string,
  timeoutMs: number,
): Promise<DiscoveryItem> {
  const item: DiscoveryItem = {
    varName: target.varName,
    resource: target.ownerResource,
    listPath: "",
    current,
    status: "miss-no-list",
  };
  if (!target.listLabel) {
    item.status = "miss-no-list";
    item.reason = `resource "${target.ownerResource}" has no list endpoint in .api-resources.yaml`;
    return item;
  }
  const parsed = parseEndpointLabel(target.listLabel);
  if (!parsed) {
    item.status = "miss-no-list";
    item.reason = `cannot parse endpoint label "${target.listLabel}"`;
    return item;
  }
  if (parsed.method !== "GET") {
    item.status = "miss-no-list";
    item.reason = `expected GET for list of ${target.ownerResource}, got ${parsed.method}`;
    return item;
  }
  // For nested list paths (e.g. /orgs/{org}/projects/), substitute any
  // parent path-params that are already known in vars. If all params resolve,
  // proceed as a normal list call. Only bail if a param is still missing.
  let effectivePath = parsed.path;
  if (parsed.path.includes("{")) {
    effectivePath = parsed.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
      const val = vars[name];
      return typeof val === "string" && val ? val : `{${name}}`;
    });
    if (effectivePath.includes("{")) {
      item.status = "miss-nested-list";
      item.reason = `nested collection (${parsed.path}) — missing parent fixture(s) in .env.yaml`;
      return item;
    }
  }
  item.listPath = effectivePath;

  // Already filled and not a placeholder → skip the call (live API, save it).
  if (!isPlaceholder(current)) {
    item.status = "skip-already-set";
    return item;
  }

  const listEp = endpoints.find(
    e => e.method.toUpperCase() === "GET" && e.path === parsed.path && !e.deprecated,
  );
  if (!listEp) {
    item.status = "miss-no-list";
    item.reason = `${parsed.path} not found in spec endpoints (resource map drift?)`;
    return item;
  }

  const url = `${baseUrl.replace(/\/+$/, "")}${effectivePath}`;
  const headers: Record<string, string> = {
    accept: "application/json",
    ...liveAuthHeaders(listEp, schemes, vars),
  };

  let resp;
  try {
    // ARV-48: 1 network-class retry with exp+jitter backoff. Transient
    // DNS/connection-reset blips on shared CI runners must not cost the
    // user a whole prepare-fixtures rerun. Only network errors retry —
    // 4xx/5xx HTTP statuses keep their existing branches (miss-status).
    resp = await executeRequest(
      { method: "GET", url, headers },
      { timeout: timeoutMs, retries: 0, network_retries: 1 },
    );
  } catch (err) {
    item.status = "miss-network";
    item.reason = `network error: ${err instanceof Error ? err.message : String(err)}`;
    return item;
  }
  if (resp.status < 200 || resp.status >= 300) {
    item.status = "miss-status";
    // ARV-99: bare `METHOD path → status` leaves the agent guessing what
    // to do. Append a status-specific next-step hint so 404 / 401 / 403 /
    // 5xx each get a routed action. Spec drift (404) and token scope
    // (401/403) are the two common root causes — call them out.
    let hint = "";
    if (resp.status === 404) {
      hint =
        ` — list endpoint 404'd. Spec may have a stale path. Try \`zond refresh-api <name>\` to re-sync; ` +
        `if the path is correct, the API likely doesn't expose this resource for your token — add the var to ` +
        `.api-resources.local.yaml as a custom create endpoint (extension overlay) or fill .env.yaml by hand`;
    } else if (resp.status === 401 || resp.status === 403) {
      hint =
        ` — auth/scope rejection on the list endpoint. Check token scope; if the token genuinely cannot list ${target.ownerResource}, ` +
        `fill .env.yaml by hand or rerun with \`--no-seed\` to skip futile attempts`;
    } else if (resp.status >= 500) {
      hint = ` — server-side error; retry later or check provider status before treating this as a fixture gap`;
    }
    item.reason = `${parsed.method} ${parsed.path} → ${resp.status}${hint}`;
    return item;
  }
  const respBody = resp.body_parsed ?? resp.body;
  const id = extractFirstField(respBody, preferredFieldFromVar(target.varName));
  if (id === undefined) {
    // TASK-273: empty target-API is the most common cause of miss-no-id on
    // fresh workspaces. Distinguish "list is well-shaped but empty" from
    // "list shape unrecognized" so the user gets actionable guidance instead
    // of guessing for 30 minutes whether zond is broken.
    if (isEmptyListBody(respBody)) {
      item.status = "miss-empty";
      // ARV-261: surface the destructive nature of --seed in the hint so
      // users don't run it against a production API without considering
      // that it POST-creates real resources on the target.
      item.reason =
        `no ${target.ownerResource} in target API — re-run with \`zond prepare-fixtures --api <name> --seed --apply\` ` +
        `to POST-create one automatically (⚠ creates real resources on the target API — use only against a throwaway/test environment), ` +
        `or create the resource yourself (in the product UI or via API) and re-run discover`;
    } else {
      item.status = "miss-no-id";
      item.reason = `response shape has no extractable first id (no array/data/items/results/records field)`;
    }
    return item;
  }
  if (current && current === id) {
    item.discovered = id;
    item.status = "skip-already-equal";
    return item;
  }
  item.discovered = id;
  item.status = "write";
  return item;
}

/** TASK-281: GET <ownerResource>'s read-by-id endpoint with the current
 *  fixture value and classify the result. 5xx is treated as `unknown` (don't
 *  trash valid fixtures over a flaky API). */
export async function verifyOne(
  target: FkTarget,
  current: string | undefined,
  ownerResource: ResourceYaml | undefined,
  endpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
  baseUrl: string,
  timeoutMs: number,
): Promise<DiscoveryItem> {
  const item: DiscoveryItem = {
    varName: target.varName,
    resource: target.ownerResource,
    listPath: "",
    current,
    status: "verify-unknown",
  };
  if (isPlaceholder(current)) {
    item.status = "verify-skip-empty";
    item.reason = "fixture is empty/placeholder — nothing to verify";
    return item;
  }
  if (!ownerResource?.endpoints?.read) {
    item.status = "verify-no-read";
    item.reason = `resource "${target.ownerResource}" has no read-by-id endpoint in .api-resources.yaml`;
    return item;
  }
  const parsed = parseEndpointLabel(ownerResource.endpoints.read);
  if (!parsed) {
    item.status = "verify-no-read";
    item.reason = `cannot parse read endpoint label "${ownerResource.endpoints.read}"`;
    return item;
  }
  // Substitute parent path-params from env vars; the resource's own idParam is
  // taken from `current` (we are verifying that very value).
  const idParam = ownerResource.idParam;
  let effectivePath = parsed.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    if (name === idParam) return current!;
    const val = vars[name];
    return typeof val === "string" && val ? val : `{${name}}`;
  });
  if (effectivePath.includes("{")) {
    item.status = "verify-unknown";
    item.reason = `cannot resolve parent path-params for ${parsed.path}`;
    return item;
  }
  item.listPath = effectivePath;

  const ep = endpoints.find(
    e => e.method.toUpperCase() === "GET" && e.path === parsed.path && !e.deprecated,
  );
  const url = `${baseUrl.replace(/\/+$/, "")}${effectivePath}`;
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(ep ? liveAuthHeaders(ep, schemes, vars) : {}),
  };
  let resp;
  try {
    // ARV-48: same single network-class retry as the discover probe.
    resp = await executeRequest({ method: "GET", url, headers }, { timeout: timeoutMs, retries: 0, network_retries: 1 });
  } catch (err) {
    item.status = "verify-unknown";
    item.reason = `network error: ${err instanceof Error ? err.message : String(err)}`;
    return item;
  }
  if (resp.status >= 200 && resp.status < 300) {
    item.status = "verify-live";
    item.discovered = current;
    return item;
  }
  if (resp.status === 404 || resp.status === 410) {
    item.status = "verify-stale";
    item.reason = `${parsed.method} ${effectivePath} → ${resp.status}`;
    return item;
  }
  // 401/403 — token/scope issue, not a stale id; 5xx — flake; treat both as
  // unknown so we never delete a fixture on shaky evidence.
  item.status = "verify-unknown";
  item.reason = `${parsed.method} ${effectivePath} → ${resp.status}`;
  return item;
}

/** Append-or-update a key in YAML text. Conservative: matches `<key>:` at
 *  the start of a line and rewrites the value, preserving trailing comments
 *  that documented original placeholders. */
export function upsertEnvLine(yamlText: string, key: string, value: string): string {
  const lines = yamlText.split("\n");
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`);
  const idx = lines.findIndex(l => re.test(l));
  const newLine = `${key}: ${JSON.stringify(value)}`;
  if (idx === -1) {
    // Insert before final newline if file ends with one, otherwise append.
    if (lines[lines.length - 1] === "") {
      lines.splice(lines.length - 1, 0, newLine);
    } else {
      lines.push(newLine);
    }
  } else {
    lines[idx] = newLine;
  }
  return lines.join("\n");
}

export async function discoverCommand(options: DiscoverOptions): Promise<number> {
  const commandName = options.commandName ?? "discover";
  try {
    const doc = await readOpenApiSpec(options.specPath);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);

    const resourceMap = await readResourceMap(options.apiDir);
    if (!resourceMap || resourceMap.resources.length === 0) {
      const msg = `No .api-resources.yaml in ${options.apiDir}. Run 'zond refresh-api <name>' to (re)build it.`;
      if (options.json) printJson(jsonError(commandName, [msg]));
      else printError(msg);
      return 2;
    }

    const envPath = options.envPath ?? join(options.apiDir, ".env.yaml");
    const env = (await loadEnvFile(envPath)) ?? {};
    // ARV-143 follow-up (security regression fix): register every loaded var
    // with the SecretRegistry so the user-config bucket (and any other path
    // that incidentally echoes a value) can't leak `.secrets.yaml`-resolved
    // tokens to stdout / scrollback / tee. base_url is filtered out because
    // we have to print it verbatim in the discovery header.
    {
      const reg = getSecretRegistry();
      for (const [k, v] of Object.entries(env)) {
        if (k === "base_url") continue;
        reg.register(k, v);
      }
    }
    const baseUrl = env["base_url"];
    if (!baseUrl) {
      const msg = `base_url is required in ${envPath} (live API calls need it).`;
      if (options.json) printJson(jsonError(commandName, [msg]));
      else printError(msg);
      return 2;
    }

    // ARV-46: manifest is the source-of-truth for the *list* of variables
    // this API needs (per decision-7). When `.api-fixtures.yaml` exists,
    // discover iterates it instead of `.env.yaml` keys / FK deps directly,
    // so vars present in tests but absent from FK deps still show up in the
    // status table — and env keys without a manifest entry surface as a
    // warning instead of being silently ignored.
    const manifest = await readFixtureManifest(options.apiDir);

    const targets = collectTargets(resourceMap);
    if (targets.length === 0 && !manifest) {
      if (options.json) {
        printJson(jsonOk(commandName, { items: [], message: "No path-FK dependencies with known owner resources." }));
      } else {
        console.log("No path-FK dependencies with known owner resources — nothing to discover.");
      }
      return 0;
    }
    // Index targets by var name so manifest entries can resolve their owner
    // resource via the FK chain (manifest knows *what*, resource map knows
    // *where to fetch*).
    const targetsByVar = new Map<string, FkTarget>();
    for (const t of targets) targetsByVar.set(t.varName, t);
    // Resource map's `collectPathFkDeps` skips the resource's own idParam —
    // it only emits *parent* FKs. The manifest legitimately wants discover
    // to fill `api_key_id` (idParam of /api-keys/{api_key_id}) from the list
    // endpoint /api-keys, so wire each resource's own idParam onto its list
    // endpoint here. This is what makes "discover walks the manifest" not
    // collapse 80% of entries into failed:no-list-endpoint.
    for (const r of resourceMap.resources) {
      if (!r.idParam || !r.endpoints?.list) continue;
      if (targetsByVar.has(r.idParam)) continue;
      targetsByVar.set(r.idParam, {
        varName: r.idParam,
        ownerResource: r.resource,
        listLabel: r.endpoints.list,
      });
    }

    // TASK-281: --verify mode — GET the read-by-id endpoint for every fixture
    // and classify (live / stale / unknown). Without --apply this is purely
    // diagnostic; with --apply we unset stale entries and re-resolve them via
    // the regular discover flow below.
    const items: DiscoveryItem[] = [];
    if (options.verify) {
      for (const target of targets) {
        const owner = resourceMap.resources.find(r => r.resource === target.ownerResource);
        const item = await verifyOne(
          target,
          env[target.varName],
          owner,
          endpoints,
          securitySchemes,
          env,
          baseUrl,
          options.timeoutMs ?? 30000,
        );
        items.push(item);
      }

      // For each stale fixture, drop it from env so the upcoming probeOne call
      // treats it as a placeholder and re-resolves through the list endpoint.
      // Without --apply we stop here — verify is read-only by default.
      if (options.apply) {
        for (const item of items) {
          if (item.status === "verify-stale") delete env[item.varName];
        }
        // Re-resolve only the previously-stale targets — leaves unverified live
        // ones in place (no point hitting the list endpoint for them).
        const staleTargets = targets.filter(t => items.some(i => i.varName === t.varName && i.status === "verify-stale"));
        for (const target of staleTargets) {
          const refreshed = await probeOne(
            target,
            env[target.varName],
            endpoints,
            securitySchemes,
            env,
            baseUrl,
            options.timeoutMs ?? 30000,
          );
          // Replace the verify-stale entry with the refresh outcome.
          // ARV-142: preserve the wasStale marker so summary can count
          // stale_fixed (refresh succeeded) vs still_stale (refresh failed).
          const idx = items.findIndex(i => i.varName === target.varName);
          if (idx >= 0) {
            refreshed.wasStale = true;
            items[idx] = refreshed;
          }
        }
      }

      // ARV-143: surface filled vars that verify can't validate so the user
      // doesn't think they're missing. Two buckets:
      //   1. manifest user-config sources (auth / server / header) — never
      //      had a read endpoint, refresh just trusts the value.
      //   2. targets whose verifyOne returned verify-no-read (resource exists
      //      but `.api-resources.yaml` has no read endpoint) — same story.
      // Without this, refresh emitted "0 stale" + silence on these vars,
      // contradicting doctor's set:true reporting (feedback-02 F12).
      if (manifest) {
        const seen = new Set(items.map(i => i.varName));
        for (const entry of manifest.fixtures) {
          if (seen.has(entry.name)) continue;
          const current = env[entry.name];
          if (!current || isPlaceholder(current)) continue;
          const isUserConfig =
            entry.source === "auth" ||
            entry.source === "server" ||
            entry.source === "header";
          if (!isUserConfig) continue;
          items.push({
            varName: entry.name,
            resource: "",
            listPath: "",
            current,
            status: "verify-user-config",
            manifestSource: entry.source,
            reason: `${entry.source} var — no verification path, value trusted from .env.yaml`,
          });
        }
        // Promote verify-no-read items with a filled value to the same bucket
        // so they show up under "trusted user input" in the summary instead of
        // being lumped with empty/skip items.
        for (const item of items) {
          if (item.status === "verify-no-read" && item.current && !isPlaceholder(item.current)) {
            item.status = "verify-user-config";
            item.reason = `no read-by-id endpoint in .api-resources.yaml — value trusted from .env.yaml`;
          }
        }
      }
    } else if (manifest) {
      // ARV-46: drive the loop by manifest entries (one row per entry).
      // Each entry's status maps onto the manifest-grade enum so agents
      // get a stable contract independent of the underlying probe shape.
      for (const entry of manifest.fixtures) {
        const current = env[entry.name];
        const placeholder: DiscoveryItem = {
          varName: entry.name,
          resource: "",
          listPath: "",
          current,
          status: "skip-not-required",
          manifestSource: entry.source,
        };

        // Sources that discover does not own: the user fills these (auth/
        // server/header) or the runtime captures them (capture-chain).
        // required:false manifest entries (currently capture-chain) are also
        // not the discover loop's responsibility.
        const isOwnedByDiscover =
          entry.required && (entry.source === "path" || entry.source === "body-fk");
        if (!isOwnedByDiscover) {
          placeholder.status = "skip-not-required";
          placeholder.manifestStatus = "skipped:not-required";
          items.push(placeholder);
          continue;
        }

        // Already filled (and not a TODO placeholder) — leave it alone.
        if (!isPlaceholder(current)) {
          placeholder.status = "skip-already-set";
          placeholder.manifestStatus = "skipped:already-set";
          items.push(placeholder);
          continue;
        }

        // Resolve owner resource via FK chain. body-fk vars often share the
        // name with a path-param of another resource (audience_id ↔
        // /audiences/{id}); resource map's collectBodyFkDeps already does
        // name-stemming inference for us. A miss here means we have nothing
        // to GET — the entry stays in the table as failed:no-list-endpoint.
        let target = targetsByVar.get(entry.name);
        if (!target) {
          // ARV-69 (feedback round-02 / F10): the resource map only links a
          // var to a list endpoint when the path explicitly carries it as a
          // path-param (e.g. /audiences/{audience_id}). common-style APIs
          // commonly use the generic {id} placeholder, so vars like
          // `domain_id` / `segment_id` / `log_id` end up with no fkDep edge
          // even though /domains, /segments, /logs are perfectly usable as
          // list endpoints. Try a name-stemming fallback: strip the FK
          // suffix and match a resource whose name is the singular or plural
          // form.
          const inferred = inferOwnerFromVarName(entry.name, resourceMap);
          if (inferred) target = inferred;
        }
        if (!target) {
          placeholder.status = "miss-no-list";
          placeholder.manifestStatus = "failed:no-list-endpoint";
          placeholder.reason = `${entry.source}-source var has no owner resource in .api-resources.yaml — cannot derive a list endpoint`;
          items.push(placeholder);
          continue;
        }

        const item = await probeOne(
          target,
          current,
          endpoints,
          securitySchemes,
          env,
          baseUrl,
          options.timeoutMs ?? 30000,
        );
        item.manifestSource = entry.source;
        item.manifestStatus = toManifestStatus(item.status);
        items.push(item);
      }
    } else {
      // Legacy path: no manifest in the workspace — probe FK targets directly.
      for (const target of targets) {
        const current = env[target.varName];
        const item = await probeOne(
          target,
          current,
          endpoints,
          securitySchemes,
          env,
          baseUrl,
          options.timeoutMs ?? 30000,
        );
        items.push(item);
      }
    }

    // TASK-294: stamp every item with recommended_action before consumers
    // (--json envelope, summary printer) read it.
    for (const it of items) {
      const action = discoveryAction(it.status);
      if (action) it.recommended_action = action;
    }

    const writes = items.filter(i => i.status === "write");
    let applied = false;
    let backupPath: string | null = null;
    if (options.apply && writes.length > 0) {
      backupPath = `${envPath}.bak`;
      try {
        await copyFile(envPath, backupPath);
      } catch {
        // missing source — write fresh; no backup needed.
        backupPath = null;
      }
      const file = Bun.file(envPath);
      let text = (await file.exists()) ? await file.text() : "";
      for (const w of writes) {
        text = upsertEnvLine(text, w.varName, w.discovered!);
      }
      if (!text.endsWith("\n")) text += "\n";
      await Bun.write(envPath, text);
      applied = true;
    }

    // ARV-46: env keys without a manifest entry are noise — the user (or a
    // legacy hand-edit) put them there; the API doesn't actually need them.
    // Surface as warning so they can be removed; do not act on them.
    // ARV-260: exclude auto-managed auth keys (auth_token, api_key) — zond
    // itself writes them at `add api` time and uses them to inject the
    // Authorization/X-API-Key header even when the spec lacks
    // securitySchemes. They are not in the fixtures manifest by design.
    // Without this filter, prepare-fixtures tells users to "drop them from
    // .env.yaml or run refresh-api" — both wrong actions that would break
    // auth.
    const AUTO_MANAGED_KEYS = new Set(["auth_token", "api_key"]);
    let unknownEnvKeys: string[] = [];
    if (manifest) {
      const manifestNames = new Set(manifest.fixtures.map(f => f.name));
      unknownEnvKeys = Object.keys(env).filter(
        k => !manifestNames.has(k) && !AUTO_MANAGED_KEYS.has(k),
      );
    }

    const requiredManifestCount = manifest
      ? manifest.fixtures.filter(f => f.required).length
      : 0;
    // ARV-143: in verify/refresh mode `manifestStatus` is not populated by
    // the verify loop (it uses verify-* statuses instead). Count verify-live
    // and verify-user-config as "filled" so the "Filled X/Y" line agrees with
    // doctor and the user_config bucket isn't double-counted as UNSET.
    const filledCount = items.filter(i =>
      i.manifestStatus === "filled" ||
      i.status === "verify-live" ||
      i.status === "verify-user-config" ||
      (i.wasStale === true && i.status === "write"),
    ).length;

    if (options.json) {
      // ARV-143 follow-up: strip raw secret values from items[].current so the
      // JSON envelope can't leak `.secrets.yaml`-resolved tokens. The
      // SecretRegistry registered every non-base_url env var above, so
      // redactObject swaps any registered value for `<redacted:<name>>`.
      const safeItems = getSecretRegistry().redactObject(items);
      printJson(jsonOk(commandName, {
        envPath,
        applied,
        backup: backupPath,
        items: safeItems,
        summary: {
          total: items.length,
          writes: writes.length,
          alreadySet: items.filter(i => i.status === "skip-already-set").length,
          misses: items.filter(i => i.status.startsWith("miss-")).length,
          ...(manifest ? {
            manifest: {
              required: requiredManifestCount,
              filled: filledCount,
              unknownEnvKeys,
            },
          } : {}),
          ...(options.verify ? {
            verify: {
              live: items.filter(i => i.status === "verify-live").length,
              // ARV-142: items currently classified as stale (refresh didn't
              // overwrite them — either --apply was off, or refresh failed).
              stale: items.filter(i => i.status === "verify-stale").length,
              // ARV-142: stale items that --refresh successfully re-resolved.
              stale_fixed: items.filter(i => i.wasStale === true && i.status === "write").length,
              // ARV-142: stale items where --refresh ran but couldn't write a
              // new value (e.g. list endpoint empty / unreachable).
              still_stale: items.filter(i => i.wasStale === true && i.status !== "write").length,
              unknown: items.filter(i => i.status === "verify-unknown").length,
              skipped: items.filter(i => i.status === "verify-skip-empty" || i.status === "verify-no-read").length,
              // ARV-143: filled vars with no verify path (user-config /
              // resource-without-read). Doctor reports these as set:true;
              // refresh now agrees by surfacing them in their own bucket.
              user_config: items.filter(i => i.status === "verify-user-config").length,
            },
          } : {}),
        },
      }));
    } else {
      console.log(`Discovery against ${baseUrl} (${envPath}):`);
      console.log("");
      const cols = ["var", "source", "resource", "list", "status", "value/reason"];
      const rows = items.map(i => [
        i.varName,
        i.manifestSource ?? "—",
        i.resource || "—",
        i.listPath || "—",
        i.manifestStatus ?? i.status,
        i.status === "write"
          ? i.discovered!
          : i.status === "skip-already-set"
            ? `(kept: ${i.current})`
            : i.status === "skip-already-equal"
              ? `(unchanged: ${i.current})`
              : i.status === "skip-not-required"
                ? `(not owned by discover)`
                : i.status === "verify-live"
                  ? `(live: ${i.current})`
                  : i.status === "verify-stale"
                    ? `(stale: ${i.current})${i.reason ? ` — ${i.reason}` : ""}`
                    : i.status === "verify-user-config"
                      // ARV-143 follow-up: never echo the raw value here —
                      // auth/header sources routinely carry tokens, and even
                      // server URLs can be sensitive. Mirror doctor's
                      // set/length-only contract from .secrets.yaml handling.
                      ? `(trusted, length=${(i.current ?? "").length})`
                      : (i.reason ?? ""),
      ]);
      // ARV-143 follow-up: redact every text cell through SecretRegistry so
      // an `auth_token` that happens to slip into a `(kept: ...)` /
      // `(live: ...)` cell can't reach stdout / scrollback / tee. The
      // verify-user-config branch already substitutes length-only — this
      // is defense in depth for the other status branches.
      const reg = getSecretRegistry();
      for (const r of rows) for (let i = 0; i < r.length; i++) r[i] = reg.redact(r[i]!);
      const widths = cols.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]!.length)));
      const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
      console.log(fmt(cols));
      console.log(widths.map(w => "─".repeat(w)).join("  "));
      for (const r of rows) console.log(fmt(r));
      console.log("");
      if (options.verify) {
        const live = items.filter(i => i.status === "verify-live").length;
        const stale = items.filter(i => i.status === "verify-stale").length;
        const unknown = items.filter(i => i.status === "verify-unknown").length;
        // ARV-142: split stale-fixed vs still-stale so refresh telemetry no
        // longer hides "0 stale" while quietly overwriting on disk.
        const staleFixed = items.filter(i => i.wasStale === true && i.status === "write").length;
        const stillStale = items.filter(i => i.wasStale === true && i.status !== "write").length;
        // ARV-143: filled vars verify can't reach — call them out as trusted.
        const userConfig = items.filter(i => i.status === "verify-user-config").length;
        const parts = [`${live} live`, `${stale} stale`];
        if (staleFixed > 0) parts.push(`${staleFixed} stale-fixed`);
        if (stillStale > 0) parts.push(`${stillStale} still-stale`);
        parts.push(`${unknown} unknown`);
        if (userConfig > 0) parts.push(`${userConfig} trusted (no-verify-path)`);
        console.log(`Verify summary: ${parts.join(", ")}.`);
        if (stale > 0 && !options.apply) {
          printWarning(`${stale} stale fixture(s) detected. Re-run with --refresh to drop and re-resolve them.`);
        }
      }
      if (manifest) {
        console.log(`Filled ${filledCount} / ${requiredManifestCount} manifest entries.`);
      }
      if (unknownEnvKeys.length > 0) {
        printWarning(
          `${unknownEnvKeys.length} env key(s) not in manifest, ignored: ${unknownEnvKeys.join(", ")}. Drop them from .env.yaml or run \`zond refresh-api\` if the manifest is stale.`,
        );
      }
      if (applied) {
        printSuccess(`Wrote ${writes.length} value(s) to ${envPath}` + (backupPath ? ` (backup: ${backupPath})` : ""));
      } else if (writes.length === 0) {
        if (!options.verify) console.log("Nothing to write (all targets already set or no discoveries succeeded).");
      } else {
        printWarning(`Dry-run: ${writes.length} value(s) ready. Re-run with --apply to write ${envPath}.`);
      }
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) printJson(jsonError(commandName, [message]));
    else printError(message);
    return 2;
  }
}

// ARV-130 (m-19): file kept on purpose. CLI registration is owned by
// ./prepare-fixtures.ts (TASK-299, m-13 D); the `discoverCommand` core
// above is consumed both by that wrapper and by direct unit tests
// (`tests/cli/discover*.test.ts`). It is NOT a deprecated alias for a
// top-level `zond discover` command — that command does not exist and
// has never been registered in `src/cli/program.ts`. See the m-19
// audit note in backlog/tasks/arv-130.

/**
 * Build `.api-resources.yaml` — the CRUD-chain map of an API.
 *
 * Purpose: skill code (scenario authoring, audit setup) reads this instead
 * of grep'ing the OpenAPI spec to answer "what resources can I CRUD, what
 * field captures the id, are there ETag / soft-delete pitfalls". The
 * extended form also lists FK dependencies so a scenario can plan a
 * setup chain (audience → contact requires audience_id, etc.).
 *
 * The file is git-trackable evidence of the API's surface; regenerated
 * by `zond add api` and (later) `zond refresh-api`.
 */

import type { EndpointInfo, CrudGroup } from "./types.ts";
import type { OpenAPIV3 } from "openapi-types";
import { detectCrudGroups, singularizeResource } from "./suite-generator.ts";

export interface ResourceFkRef {
  /** Variable name expected in `.env.yaml` to satisfy the FK (e.g. `audience_id`). */
  var: string;
  /** Path-parameter or body-field name that consumes the FK in the API. */
  param: string;
  /** Where the value gets injected: path | body. */
  in: "path" | "body";
  /** Resource name we believe owns this id (best-effort, may be null). */
  ownerResource: string | null;
}

/**
 * ARV-169 (m-20 cross-call drift): per-resource overrides for the
 * POST→GET shape-diff probe. All fields optional — when absent the
 * check falls back to `DEFAULT_READBACK_IGNORE` (timestamp / etag /
 * envelope quirks) so a probe works on a stock spec without yaml work.
 * Authored by `zond api annotate --readback` (ARV-187) or by hand.
 */
export interface ReadbackDiffConfig {
  /** Field names dropped before diff. Suppresses known API-quirks
   *  (Stripe `metadata` stripping, livemode, object discriminators)
   *  so they don't drown out real drift. */
  ignoreFields?: string[];
  /** Write-shape → read-shape rename. Stripe takes `tax_id_data` on
   *  create but exposes it as `tax_ids` on read; without this the
   *  field looks like state-not-persisted on every probe. */
  writeToReadMap?: Record<string, string>;
}

/**
 * ARV-170 (m-20 idempotency-replay): per-resource declaration that the
 * create endpoint honors an Idempotency-Key header. When present, the
 * `idempotency_replay` stateful check sends POST twice with the same
 * key and asserts (a) no duplicate resource is created and (b) the two
 * responses are bit-identical modulo `ignoreResponseFields`.
 *
 * Auto-detect fallback: if `idempotency:` is absent from yaml but the
 * create endpoint declares an `Idempotency-Key` header parameter in
 * the spec, the check still runs with `header="Idempotency-Key"` and
 * the default ignore list. Explicit yaml is preferred — it documents
 * intent and lets the user customise the ignore list per API quirks
 * (Stripe `request_id`, Resend `retry_after`).
 */
export interface IdempotencyConfig {
  /** Header that carries the key. Default `Idempotency-Key`. */
  header?: string;
  /** Informational. `endpoint` = key scoped per-endpoint (Stripe).
   *  `global` = same key replays across endpoints. Today the check
   *  uses the same flow either way; field is read for diagnostics. */
  scope?: "endpoint" | "global";
  /** Response-body field names stripped before the R1==R2 compare.
   *  Defaults to a baseline list shared with readback-diff
   *  (timestamps, request_id, etag) when omitted. */
  ignoreResponseFields?: string[];
}

/**
 * ARV-171 (m-20 pagination-invariants): per-list-endpoint declaration
 * of the pagination strategy. The `pagination_invariants` stateful
 * check uses this to ask for two consecutive pages and assert
 * disjointness + has_more consistency.
 *
 * Supported types in this milestone:
 *   • `cursor` — Stripe-style: caller passes a cursor (e.g.
 *     `starting_after=<id>`) derived from the last item of the
 *     previous page.
 *   • `page` — page-number style (GitHub, GitLab, Atlassian, Notion,
 *     Linear): `?page=N&per_page=M`. ARV-220 enabled this in m-21.
 *   • `offset` and `token` — declared for forward compatibility; the
 *     check currently skips with a "pagination type not implemented"
 *     reason so the yaml block stays a stable schema.
 *
 * Auto-detect fallback: if the list endpoint declares `starting_after`
 * / `cursor` / `page_token` query parameters in the spec, the check
 * uses sensible defaults (cursor_field=`id`, items_field=`data` →
 * `items` → `results`, has_more_field=`has_more`). Explicit yaml is
 * preferred — it documents intent and survives spec changes that
 * rename query params.
 */
/**
 * ARV-172 (m-20 lifecycle-transitions): declared state machine for a
 * resource. Used by the `lifecycle_transitions` stateful check to
 * verify that documented actions (cancel / archive / publish / ...)
 * move a resource between declared states and that double-invoking an
 * action either 4xx's or stays idempotent (no state regression).
 *
 * The yaml block has three parts:
 *   • `field` + `states` — name of the response field carrying the
 *     state, plus the closed enum of legal values.
 *   • `transitions` — a from→to graph; the check uses it to flag
 *     forbidden transitions (cancelled → active) when an action lands
 *     a resource somewhere the graph doesn't allow.
 *   • `actions` — POST endpoints that should drive a transition.
 *     `expected_state` is the state the resource must be in after a
 *     successful action call.
 *
 * Manifest validation runs at load time and surfaces obvious
 * authoring bugs (unreachable states, missing terminal, action
 * referencing an undeclared state) before any HTTP call goes out.
 */
export interface LifecycleAction {
  /** Endpoint label, e.g. "POST /v1/subscriptions/{id}/cancel". The
   *  `{id}` placeholder is substituted with the created resource id. */
  endpoint: string;
  /** State the resource must be in after this action lands. */
  expectedState: string;
  /** Optional request body sent with the action POST. Most lifecycle
   *  actions are body-less (cancel, archive, publish); leave empty
   *  when not needed. Serialised as JSON or form depending on the
   *  endpoint's declared content type. */
  body?: Record<string, unknown>;
}

export interface LifecycleConfig {
  /** Response field name carrying the state (e.g. `status`). */
  field: string;
  /** Closed enum of legal state values. Any state observed on the
   *  wire that isn't in this list is a finding. */
  states: string[];
  /** Allowed from→to graph. States not listed as `from` are assumed
   *  terminal (no outgoing transition). States not listed as `to` of
   *  any transition are starting-only (unreachable post-create). */
  transitions: { from: string; to: string[] }[];
  /** Named actions keyed by action name (cancel / archive / publish).
   *  The check runs through them in object-key order. */
  actions: Record<string, LifecycleAction>;
}

/**
 * Static validation of a lifecycle manifest. Returns the list of
 * authoring bugs without throwing — callers decide whether to fail
 * the run or just warn. Empty array = clean manifest.
 */
export function validateLifecycleManifest(cfg: LifecycleConfig): string[] {
  const errors: string[] = [];
  if (!cfg.field || cfg.field.length === 0) errors.push("lifecycle.field is empty");
  if (!cfg.states || cfg.states.length === 0) errors.push("lifecycle.states is empty");
  const stateSet = new Set(cfg.states ?? []);
  for (const t of cfg.transitions ?? []) {
    if (!stateSet.has(t.from)) errors.push(`transitions: unknown "from" state "${t.from}"`);
    for (const to of t.to) {
      if (!stateSet.has(to)) errors.push(`transitions[${t.from}]: unknown "to" state "${to}"`);
    }
  }
  // At least one terminal — a state with no outgoing transition (or
  // an explicit `to: []`). A graph with every state having outgoing
  // edges is suspicious (no end-of-life, infinite churn).
  const hasOutgoing = new Set((cfg.transitions ?? []).filter((t) => t.to.length > 0).map((t) => t.from));
  const terminals = (cfg.states ?? []).filter((s) => !hasOutgoing.has(s));
  if (terminals.length === 0) errors.push("no terminal state — every declared state has outgoing transitions");
  // Actions must reference declared states.
  for (const [name, a] of Object.entries(cfg.actions ?? {})) {
    if (!stateSet.has(a.expectedState)) {
      errors.push(`actions.${name}.expected_state "${a.expectedState}" is not in states[]`);
    }
    if (!a.endpoint || a.endpoint.length === 0) {
      errors.push(`actions.${name}.endpoint is empty`);
    }
  }
  return errors;
}

export interface PaginationConfig {
  /** Pagination flavor. Default `cursor`. */
  type?: "cursor" | "page" | "offset" | "token";
  /** Query-param name that takes the cursor value. Default `starting_after`.
   *  Only used when `type: cursor`. */
  cursorParam?: string;
  /** Response field on each item that becomes the next cursor (cursor-style)
   *  and the dedupe key when comparing pages (both styles). Default `id`. */
  cursorField?: string;
  /** Response field that signals "more pages remain". Default `has_more`.
   *  Only consulted for `type: cursor` — page-style APIs typically rely on
   *  Link headers or `total_pages` instead, so the field is ignored there. */
  hasMoreField?: string;
  /** Query-param name for page size. Default `limit` for cursor-style,
   *  `per_page` for page-style. */
  limitParam?: string;
  /** Probe page-size. Default 2 (small enough to land two replies fast). */
  defaultLimit?: number;
  /** Response field carrying the array of items. Default `data` (Stripe);
   *  falls back to `items` / `results` when missing. */
  itemsField?: string;
  /** Page-number query-param name. Default `page`. Only used when `type: page`. */
  pageParam?: string;
  /** First page number (1-based on GitHub/GitLab, 0-based on some custom APIs).
   *  Default 1. Only used when `type: page`. */
  startPage?: number;
}

/** ARV-187: LLM-authored example POST body. Stateful checks prefer this
 *  over generateFromSchema(create) when present. */
export interface SeedBodyConfig {
  /** Defaults to the create endpoint's requestBodyContentType. */
  contentType?: string;
  body: Record<string, unknown>;
}

export interface ApiResourceEntry {
  resource: string;
  basePath: string;
  itemPath: string;
  idParam: string;
  /** What field on the create response carries the new id (typically `id`). */
  captureField: string;
  /** True when the resource exposes List + Create + Read at minimum. */
  hasFullCrud: boolean;
  endpoints: {
    list?: string;     // "GET /audiences"
    create?: string;
    read?: string;
    update?: string;
    delete?: string;
  };
  /** Update/Delete demand If-Match? (heuristic: 412 in spec or ETag in headers). */
  requiresEtag?: boolean;
  /** Heuristic: read-after-delete returns 200 instead of 404 (filled at runtime, default false). */
  softDelete?: boolean;
  /** Other resources whose ids this resource consumes (FK chain). */
  fkDependencies: ResourceFkRef[];
  /** ARV-169: optional cross-call-drift overrides. */
  readbackDiff?: ReadbackDiffConfig;
  /** ARV-170: opt-in idempotency-replay probe. */
  idempotency?: IdempotencyConfig;
  /** ARV-171: pagination-invariants probe. */
  pagination?: PaginationConfig;
  /** ARV-172: state-machine for the resource. */
  lifecycle?: LifecycleConfig;
}

export interface ApiResourceMap {
  generatedAt: string;
  specHash: string;
  resourceCount: number;
  resources: ApiResourceEntry[];
  /** Endpoints that didn't fit any CRUD group (action endpoints, RPC-style). */
  orphanEndpoints: string[];
}

function epLabel(ep: EndpointInfo): string {
  return `${ep.method.toUpperCase()} ${ep.path}`;
}

function pathStripSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

function isParamSeg(seg: string | undefined): boolean {
  return !!seg && /^\{[^}]+\}$/.test(seg);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ARV-134 (resource-builder fix #1): when two CRUD groups would collide on
 * the same `resource` name (e.g. `POST /segments` and `POST /contacts/
 * {contact_id}/segments` both produce `resource: "segments"`), keep the
 * canonical (shortest basePath) entry and rename the nested ones to
 * `<parent-noun>_<resource>` — `contact_segments` here. Without this,
 * `.api-resources.yaml` ends up with duplicate entries that break
 * map-by-name lookups (annotate overlay, refresh-api idempotence,
 * stateful-check resource configs).
 */
function disambiguateResourceCollisions(groups: CrudGroup[]): CrudGroup[] {
  const byName = new Map<string, CrudGroup[]>();
  for (const g of groups) {
    const arr = byName.get(g.resource) ?? [];
    arr.push(g);
    byName.set(g.resource, arr);
  }

  const renames = new Map<CrudGroup, string>();
  const usedNames = new Set<string>(byName.keys());

  for (const [name, members] of byName) {
    if (members.length < 2) continue;
    // Canonical name goes to the entry with the *strictly* shortest
    // basePath (the top-level collection in the typical /segments vs
    // /contacts/{id}/segments case). If two members tie for shortest,
    // there is no obvious winner — rename all of them so the yaml never
    // silently picks one arbitrary entry as canonical.
    const sorted = [...members].sort((a, b) => a.basePath.length - b.basePath.length);
    const shortest = sorted[0]!.basePath.length;
    const tiedAtShortest = sorted.filter(g => g.basePath.length === shortest).length;
    const startFromIndex = tiedAtShortest === 1 ? 1 : 0;

    for (let i = startFromIndex; i < sorted.length; i++) {
      const g = sorted[i]!;
      const prefix = parentNounForBasePath(g.basePath);
      const singularPrefix = prefix ? singularizeResource(prefix) : null;
      let candidate = singularPrefix ? `${singularPrefix}_${name}` : `${name}_${i + 1}`;
      let n = 2;
      while (usedNames.has(candidate)) {
        candidate = singularPrefix ? `${singularPrefix}_${name}_${n++}` : `${name}_${n++}`;
      }
      usedNames.add(candidate);
      renames.set(g, candidate);
    }
  }

  if (renames.size === 0) return groups;
  return groups.map(g => (renames.has(g) ? { ...g, resource: renames.get(g)! } : g));
}

/**
 * ARV-134 follow-up: same rename strategy as `disambiguateResourceCollisions`,
 * but operating on the final `ApiResourceEntry[]` so CRUD-vs-implicit
 * name clashes also get resolved. Keeps the implementation parallel so
 * the behaviour stays consistent (strictly-shortest basePath keeps the
 * canonical name; ties get all-renamed; suffix-bumping on hash
 * collision).
 */
function disambiguateEntryCollisions(entries: ApiResourceEntry[]): ApiResourceEntry[] {
  const byName = new Map<string, ApiResourceEntry[]>();
  for (const e of entries) {
    const arr = byName.get(e.resource) ?? [];
    arr.push(e);
    byName.set(e.resource, arr);
  }

  const renames = new Map<ApiResourceEntry, string>();
  const usedNames = new Set<string>(byName.keys());

  for (const [name, members] of byName) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => a.basePath.length - b.basePath.length);
    const shortest = sorted[0]!.basePath.length;
    const tiedAtShortest = sorted.filter(e => e.basePath.length === shortest).length;
    const startFromIndex = tiedAtShortest === 1 ? 1 : 0;

    for (let i = startFromIndex; i < sorted.length; i++) {
      const e = sorted[i]!;
      const prefix = parentNounForBasePath(e.basePath);
      const singularPrefix = prefix ? singularizeResource(prefix) : null;
      let candidate = singularPrefix ? `${singularPrefix}_${name}` : `${name}_${i + 1}`;
      let n = 2;
      while (usedNames.has(candidate)) {
        candidate = singularPrefix ? `${singularPrefix}_${name}_${n++}` : `${name}_${n++}`;
      }
      usedNames.add(candidate);
      renames.set(e, candidate);
    }
  }

  if (renames.size === 0) return entries;
  return entries.map(e => (renames.has(e) ? { ...e, resource: renames.get(e)! } : e));
}

function parentNounForBasePath(basePath: string): string | null {
  const segs = pathStripSlash(basePath).split("/").filter(Boolean);
  // Skip the last segment (the resource itself); walk back to the nearest
  // non-param noun. `/contacts/{contact_id}/segments` → "contacts".
  for (let i = segs.length - 2; i >= 0; i--) {
    if (!isParamSeg(segs[i])) return segs[i]!;
  }
  return null;
}

/**
 * ARV-134 (resource-builder fix #2): for an implicit list-only resource
 * (no CRUD group), look for a GET-by-id companion endpoint that gives us
 * a real idParam + itemPath. Resend's `/logs/{log_id}` and `/automations/
 * {automation_id}/runs/{run_id}` were getting `idParam: ""` because the
 * implicit-resource constructor never inspected the spec for their item
 * endpoints — `prepare-fixtures` then skipped them.
 */
function findItemEndpointForListPath(
  listPath: string,
  endpoints: EndpointInfo[],
): EndpointInfo | null {
  const itemRe = new RegExp(`^${escapeRegex(listPath)}/\\{([^}]+)\\}/?$`);
  for (const ep of endpoints) {
    if (ep.method.toUpperCase() !== "GET" || ep.deprecated) continue;
    if (itemRe.test(pathStripSlash(ep.path))) return ep;
  }
  return null;
}

function getCaptureField(create: EndpointInfo): string {
  // Look at the create endpoint's success response schema for an `id`-ish
  // field. Falls back to "id" — the universal default.
  const success = create.responses.find(r => r.statusCode >= 200 && r.statusCode < 300);
  const schema = success?.schema as OpenAPIV3.SchemaObject | undefined;
  if (schema?.properties) {
    const props = schema.properties as Record<string, OpenAPIV3.SchemaObject>;
    for (const candidate of ["id", "uuid", "key", "code"]) {
      if (props[candidate]) return candidate;
    }
  }
  return "id";
}

/**
 * Structurally infer the list-endpoint that owns each path-parameter by
 * walking the actual URL graph in the spec. Beats name-stemming because
 *
 *  • `_id_or_slug`, `_or_name`, non-English plurals, weird casing — all
 *    transparent: we only look at segment positions, not at param names.
 *  • Returns the *exact* GET path to call, not a guessed resource name we
 *    later have to hope is wired up correctly.
 *  • Two-strategy lookup so it survives both canonical nesting
 *    (`/orgs/{org}/projects/{proj}/...` — prev seg `projects` is a list)
 *    and common SaaS-style sibling-param chains
 *    (`/projects/{org}/{proj}/...` — prev seg is itself a param;
 *    we walk back to the nearest non-param segment and search for any
 *    GET path ending with that hint).
 */
export function resolveOwnerListPaths(endpoints: EndpointInfo[]): Map<string, string> {
  const getPathSet = new Set<string>();
  const getPathsByLastSeg = new Map<string, string[]>();
  for (const ep of endpoints) {
    if (ep.method.toUpperCase() !== "GET" || ep.deprecated) continue;
    const path = pathStripSlash(ep.path);
    getPathSet.add(path);
    const segs = path.split("/").filter(Boolean);
    const last = segs[segs.length - 1];
    if (last && !isParamSeg(last)) {
      const arr = getPathsByLastSeg.get(last) ?? [];
      arr.push(path);
      getPathsByLastSeg.set(last, arr);
    }
  }

  const result = new Map<string, string>();
  const consider = (param: string, candidate: string) => {
    const existing = result.get(param);
    // Prefer shorter (more canonical/top-level) list path.
    if (!existing || candidate.length < existing.length) result.set(param, candidate);
  };

  for (const ep of endpoints) {
    if (ep.deprecated) continue;
    const segs = pathStripSlash(ep.path).split("/");
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!;
      const m = /^\{([^}]+)\}$/.exec(seg);
      if (!m) continue;
      const param = m[1]!;
      const prevSeg = segs[i - 1];

      // Strategy 1 (canonical): prev seg is a non-param noun and the
      // prefix up to (but not including) `{param}` is a GET endpoint.
      if (prevSeg && !isParamSeg(prevSeg)) {
        const prefix = segs.slice(0, i).join("/");
        if (getPathSet.has(prefix)) {
          consider(param, prefix);
          continue;
        }
      }

      // Strategy 2 (sibling-param chain): walk back to the nearest
      // non-param segment, then look for *any* GET path that terminates
      // with that segment. Pick the shortest match.
      let hint: string | undefined;
      for (let j = i - 1; j >= 0; j--) {
        const s = segs[j]!;
        if (!isParamSeg(s) && s !== "") {
          hint = s;
          break;
        }
      }
      if (!hint) continue;
      const candidates = getPathsByLastSeg.get(hint);
      if (!candidates || candidates.length === 0) continue;
      const shortest = candidates.reduce((a, b) => (a.length <= b.length ? a : b));
      consider(param, shortest);
    }
  }

  return result;
}

function listPathToResourceName(listPath: string): string {
  const segs = pathStripSlash(listPath).split("/").filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    if (!isParamSeg(segs[i])) return segs[i]!;
  }
  return "resource";
}

/**
 * Body-FK fallback. Used only when a body field's name doesn't appear
 * as a path-param anywhere (so the structural resolver has nothing to
 * say). Cheap heuristic — kept narrow on purpose.
 */
function inferFkOwnerByName(paramName: string, allResources: string[]): string | null {
  const stem = paramName
    .replace(/_id_or_slug$|_id_or_name$|_or_slug$|_or_name$/, "")
    .replace(/_id$|Id$|_uuid$|_slug$/, "")
    .toLowerCase();
  if (!stem) return null;
  for (const res of allResources) {
    const r = res.toLowerCase();
    if (r === stem || r === `${stem}s` || `${r}s` === stem || r.replace(/s$/, "") === stem) {
      return res;
    }
  }
  return null;
}

function collectPathFkDeps(
  basePath: string,
  idParam: string,
  ownerListPaths: Map<string, string>,
  resourceByListPath: Map<string, string>,
): ResourceFkRef[] {
  const deps: ResourceFkRef[] = [];
  const seen = new Set<string>();
  const pathParamRe = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pathParamRe.exec(basePath)) !== null) {
    const param = match[1]!;
    if (param === idParam) continue;
    if (seen.has(param)) continue;
    seen.add(param);
    const listPath = ownerListPaths.get(param);
    const ownerResource = listPath ? (resourceByListPath.get(listPath) ?? null) : null;
    deps.push({ var: param, param, in: "path", ownerResource });
  }
  return deps;
}

function collectBodyFkDeps(
  group: CrudGroup,
  ownerListPaths: Map<string, string>,
  resourceByListPath: Map<string, string>,
  allResources: string[],
): ResourceFkRef[] {
  const deps: ResourceFkRef[] = [];
  if (!group.create?.requestBodySchema) return deps;
  const schema = group.create.requestBodySchema as OpenAPIV3.SchemaObject;
  const props = (schema.properties ?? {}) as Record<string, OpenAPIV3.SchemaObject>;
  const required = new Set(schema.required ?? []);
  for (const [name] of Object.entries(props)) {
    if (!/_id$|Id$|_uuid$/.test(name)) continue;
    if (!required.has(name)) continue;
    // Try structural resolution first (the body field name often matches a
    // path-param elsewhere — `audience_id` body field, `audience_id` path
    // param both point at /audiences/). Fall back to name-stemming.
    let ownerResource: string | null = null;
    const listPath = ownerListPaths.get(name);
    if (listPath) ownerResource = resourceByListPath.get(listPath) ?? null;
    if (!ownerResource) ownerResource = inferFkOwnerByName(name, allResources);
    deps.push({ var: name, param: name, in: "body", ownerResource });
  }
  return deps;
}

export interface BuildResourcesParams {
  endpoints: EndpointInfo[];
  specHash: string;
}

export function buildApiResourceMap(params: BuildResourcesParams): ApiResourceMap {
  const groups = disambiguateResourceCollisions(detectCrudGroups(params.endpoints));
  const ownerListPaths = resolveOwnerListPaths(params.endpoints);

  // ARV-134: reverse-index ownerListPaths so implicit resources can fall
  // back to the FK param name when no direct GET-by-id companion exists.
  const paramsByListPath = new Map<string, string[]>();
  for (const [param, listPath] of ownerListPaths) {
    const arr = paramsByListPath.get(listPath) ?? [];
    arr.push(param);
    paramsByListPath.set(listPath, arr);
  }

  // Index CRUD-group list paths by normalised path so the FK resolver can
  // hand back the resource name a structural lookup pointed at.
  const resourceByListPath = new Map<string, string>();
  for (const g of groups) {
    if (g.list) resourceByListPath.set(pathStripSlash(g.list.path), g.resource);
  }

  // Imp resources: any list path that path-FKs point at structurally but
  // no CRUD group claims (top-level GET-only collections like
  // `/api/0/organizations/`, nested list-only collections, etc.). Without
  // these, every FK that depends on a non-CRUD parent ends up with
  // `ownerResource: null` and `discover` skips them — the actual root
  // cause of the "discover --apply is a no-op" symptom.
  const implicitResources: ApiResourceEntry[] = [];
  const seenImplicit = new Set<string>();
  for (const [, listPath] of ownerListPaths) {
    if (resourceByListPath.has(listPath)) continue;
    if (seenImplicit.has(listPath)) continue;
    seenImplicit.add(listPath);
    const listEp = params.endpoints.find(
      e =>
        e.method.toUpperCase() === "GET" &&
        !e.deprecated &&
        pathStripSlash(e.path) === listPath,
    );
    if (!listEp) continue;
    const name = listPathToResourceName(listPath);

    // ARV-134: try to recover idParam + itemPath from a GET-by-id companion
    // (e.g. implicit `logs` at `/logs` + `GET /logs/{log_id}` → log_id).
    // Falls back to the reverse-indexed ownerListPaths param when no direct
    // item endpoint exists — preferring a name that matches the resource's
    // singular form so e.g. `attachment_id` wins over a sibling FK that
    // happens to point at the same list path.
    const itemEp = findItemEndpointForListPath(listPath, params.endpoints);
    let idParam = "";
    let itemPath = "";
    const endpoints: ApiResourceEntry["endpoints"] = { list: epLabel(listEp) };
    if (itemEp) {
      const m = pathStripSlash(itemEp.path).match(/\{([^}]+)\}\/?$/);
      if (m) {
        idParam = m[1]!;
        itemPath = itemEp.path;
        endpoints.read = epLabel(itemEp);
      }
    }
    if (!idParam) {
      const candidates = paramsByListPath.get(listPath) ?? [];
      if (candidates.length > 0) {
        const singular = singularizeResource(name).toLowerCase();
        const preferred = candidates.find(p => {
          const lower = p.toLowerCase();
          return lower === singular || lower.startsWith(`${singular}_`);
        });
        idParam = preferred ?? candidates[0]!;
      }
    }

    implicitResources.push({
      resource: name,
      basePath: listPath,
      itemPath,
      idParam,
      captureField: "id",
      hasFullCrud: false,
      endpoints,
      fkDependencies: [],
    });
    resourceByListPath.set(listPath, name);
  }

  const resourceNames = [
    ...groups.map(g => g.resource),
    ...implicitResources.map(r => r.resource),
  ];

  const crudResources: ApiResourceEntry[] = groups.map(g => {
    const captureField = g.create ? getCaptureField(g.create) : "id";
    const requiresEtag = !!(g.update?.requiresEtag || g.delete?.requiresEtag);
    return {
      resource: g.resource,
      basePath: g.basePath,
      itemPath: g.itemPath,
      idParam: g.idParam,
      captureField,
      hasFullCrud: !!(g.list && g.create && g.read),
      endpoints: {
        ...(g.list ? { list: epLabel(g.list) } : {}),
        ...(g.create ? { create: epLabel(g.create) } : {}),
        ...(g.read ? { read: epLabel(g.read) } : {}),
        ...(g.update ? { update: epLabel(g.update) } : {}),
        ...(g.delete ? { delete: epLabel(g.delete) } : {}),
      },
      ...(requiresEtag ? { requiresEtag: true } : {}),
      fkDependencies: [
        ...collectPathFkDeps(g.basePath, g.idParam, ownerListPaths, resourceByListPath),
        ...collectBodyFkDeps(g, ownerListPaths, resourceByListPath, resourceNames),
      ],
    };
  });

  // Implicit resources also chain — `/orgs/{org}/projects/` lists projects
  // but needs `organization_id_or_slug` set to call. Surface that so
  // `discover` knows to fetch the parent first.
  for (const r of implicitResources) {
    r.fkDependencies = collectPathFkDeps(r.basePath, "", ownerListPaths, resourceByListPath);
  }

  // ARV-134 (follow-up): the early disambiguation pass only operated on
  // CRUD groups, but collisions also fire CRUD-vs-implicit (`/repos/
  // {owner}/{repo}/check-runs` is CRUD, `/repos/{owner}/{repo}/commits/
  // {ref}/check-runs` is implicit-list-only — both end up named
  // `check-runs`). Run the same prefix-rename here on the combined list
  // so the final yaml never carries duplicate `resource:` lines.
  const resources = disambiguateEntryCollisions([...crudResources, ...implicitResources]);

  // Endpoints that aren't in any CRUD group — RPC-style actions, webhook
  // accept-only routes, etc. Implicit-list endpoints stay in orphans
  // because they're not full CRUD; they're surfaced through resources for
  // discovery purposes only.
  const claimedEps = new Set<string>();
  for (const g of groups) {
    if (g.list) claimedEps.add(epLabel(g.list));
    if (g.create) claimedEps.add(epLabel(g.create));
    if (g.read) claimedEps.add(epLabel(g.read));
    if (g.update) claimedEps.add(epLabel(g.update));
    if (g.delete) claimedEps.add(epLabel(g.delete));
  }
  const orphanEndpoints = params.endpoints
    .filter(ep => !claimedEps.has(epLabel(ep)))
    .map(epLabel);

  return {
    generatedAt: new Date().toISOString(),
    specHash: params.specHash,
    resourceCount: resources.length,
    resources,
    orphanEndpoints,
  };
}

// ── YAML serialization (minimal, no dep on yaml lib for the workspace) ──

function escape(s: string): string {
  if (/[:#\[\]{}&*!|>'"@`,%]/.test(s) || s.includes("\n") || s === "") {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

export function serializeApiResourceMap(m: ApiResourceMap): string {
  const lines: string[] = [];
  lines.push("# Auto-generated by zond. Do not edit by hand.");
  lines.push("# Regenerate via: zond refresh-api <name>");
  lines.push(`generatedAt: ${escape(m.generatedAt)}`);
  lines.push(`specHash: ${escape(m.specHash)}`);
  lines.push(`resourceCount: ${m.resourceCount}`);
  if (m.resources.length === 0) {
    lines.push("resources: []");
  } else {
    lines.push("resources:");
  }
  for (const r of m.resources) {
    lines.push(`  - resource: ${escape(r.resource)}`);
    lines.push(`    basePath: ${escape(r.basePath)}`);
    lines.push(`    itemPath: ${escape(r.itemPath)}`);
    lines.push(`    idParam: ${escape(r.idParam)}`);
    lines.push(`    captureField: ${escape(r.captureField)}`);
    lines.push(`    hasFullCrud: ${r.hasFullCrud}`);
    if (r.requiresEtag) lines.push(`    requiresEtag: true`);
    lines.push(`    endpoints:`);
    for (const [k, v] of Object.entries(r.endpoints)) {
      lines.push(`      ${k}: ${escape(v as string)}`);
    }
    if (r.fkDependencies.length === 0) {
      lines.push(`    fkDependencies: []`);
    } else {
      lines.push(`    fkDependencies:`);
      for (const d of r.fkDependencies) {
        lines.push(`      - var: ${escape(d.var)}`);
        lines.push(`        param: ${escape(d.param)}`);
        lines.push(`        in: ${d.in}`);
        lines.push(`        ownerResource: ${d.ownerResource ? escape(d.ownerResource) : "null"}`);
      }
    }
    if (r.readbackDiff) {
      lines.push(`    readback_diff:`);
      const ig = r.readbackDiff.ignoreFields ?? [];
      if (ig.length > 0) {
        lines.push(`      ignore_fields:`);
        for (const f of ig) lines.push(`        - ${escape(f)}`);
      }
      const map = r.readbackDiff.writeToReadMap ?? {};
      const mapKeys = Object.keys(map);
      if (mapKeys.length > 0) {
        lines.push(`      write_to_read_map:`);
        for (const k of mapKeys) lines.push(`        ${escape(k)}: ${escape(map[k]!)}`);
      }
    }
    if (r.idempotency) {
      lines.push(`    idempotency:`);
      if (r.idempotency.header) lines.push(`      header: ${escape(r.idempotency.header)}`);
      if (r.idempotency.scope) lines.push(`      scope: ${r.idempotency.scope}`);
      const ig = r.idempotency.ignoreResponseFields ?? [];
      if (ig.length > 0) {
        lines.push(`      ignore_response_fields:`);
        for (const f of ig) lines.push(`        - ${escape(f)}`);
      }
    }
    if (r.pagination) {
      lines.push(`    pagination:`);
      if (r.pagination.type) lines.push(`      type: ${r.pagination.type}`);
      if (r.pagination.cursorParam) lines.push(`      cursor_param: ${escape(r.pagination.cursorParam)}`);
      if (r.pagination.cursorField) lines.push(`      cursor_field: ${escape(r.pagination.cursorField)}`);
      if (r.pagination.hasMoreField) lines.push(`      has_more_field: ${escape(r.pagination.hasMoreField)}`);
      if (r.pagination.limitParam) lines.push(`      limit_param: ${escape(r.pagination.limitParam)}`);
      if (r.pagination.defaultLimit != null) lines.push(`      default_limit: ${r.pagination.defaultLimit}`);
      if (r.pagination.itemsField) lines.push(`      items_field: ${escape(r.pagination.itemsField)}`);
      if (r.pagination.pageParam) lines.push(`      page_param: ${escape(r.pagination.pageParam)}`);
      if (r.pagination.startPage != null) lines.push(`      start_page: ${r.pagination.startPage}`);
    }
    if (r.lifecycle) {
      lines.push(`    lifecycle:`);
      lines.push(`      field: ${escape(r.lifecycle.field)}`);
      lines.push(`      states:`);
      for (const s of r.lifecycle.states) lines.push(`        - ${escape(s)}`);
      lines.push(`      transitions:`);
      for (const t of r.lifecycle.transitions) {
        lines.push(`        - from: ${escape(t.from)}`);
        if (t.to.length === 0) {
          lines.push(`          to: []`);
        } else {
          lines.push(`          to:`);
          for (const to of t.to) lines.push(`            - ${escape(to)}`);
        }
      }
      lines.push(`      actions:`);
      for (const [name, a] of Object.entries(r.lifecycle.actions)) {
        lines.push(`        ${escape(name)}:`);
        lines.push(`          endpoint: ${escape(a.endpoint)}`);
        lines.push(`          expected_state: ${escape(a.expectedState)}`);
      }
    }
  }
  if (m.orphanEndpoints.length === 0) {
    lines.push("orphanEndpoints: []");
  } else {
    lines.push("orphanEndpoints:");
    for (const e of m.orphanEndpoints) lines.push(`  - ${escape(e)}`);
  }
  return lines.join("\n") + "\n";
}

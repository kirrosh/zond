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
 *  endpoint explicitly (Resend-style {id} placeholders).
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
    | "verify-skip-empty";
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
}

export interface ApiResourceMapYaml {
  resources: ResourceYaml[];
}

export async function readResourceMap(apiDir: string): Promise<ApiResourceMapYaml | null> {
  const path = join(apiDir, ".api-resources.yaml");
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const text = await file.text();
  const parsed = Bun.YAML.parse(text);
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as { resources?: ResourceYaml[] };
  const base = obj.resources ?? [];

  // ARV-111: merge in user-maintained extensions from `.api-resources.local.yaml`
  // — a sibling file that survives `refresh-api`. Lets the user describe
  // write-only / SDK-only endpoints (Sentry's /store/ ingest, etc.) that
  // aren't in the OpenAPI spec, so prepare-fixtures --seed can still
  // POST-create them. Extensions append to the resource list; when a name
  // collides with a spec-derived resource, the extension wins (user-override).
  const extensions = await readResourceExtensions(apiDir);
  if (extensions.length === 0) return { resources: base };
  const byName = new Map<string, ResourceYaml>();
  for (const r of base) byName.set(r.resource, r);
  for (const ext of extensions) byName.set(ext.resource, ext);
  return { resources: Array.from(byName.values()) };
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
 *  attempt (we hit the owner's list endpoint once and reuse the result). */
export function collectTargets(map: ApiResourceMapYaml): FkTarget[] {
  const seen = new Set<string>();
  const out: FkTarget[] = [];
  for (const r of map.resources) {
    for (const dep of r.fkDependencies ?? []) {
      if (dep.in !== "path") continue;
      if (!dep.ownerResource) continue;
      const key = dep.var;
      if (seen.has(key)) continue;
      seen.add(key);
      const owner = map.resources.find(x => x.resource === dep.ownerResource);
      const listLabel = owner?.endpoints.list ?? "";
      out.push({ varName: dep.var, ownerResource: dep.ownerResource, listLabel });
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
    item.reason = `${parsed.method} ${parsed.path} → ${resp.status}`;
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
      item.reason =
        `no ${target.ownerResource} in target API — re-run with \`zond prepare-fixtures --api <name> --seed --apply\` ` +
        `to POST-create one automatically, or create the resource yourself (in the product UI or via API) and re-run discover`;
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
  try {
    const doc = await readOpenApiSpec(options.specPath);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);

    const resourceMap = await readResourceMap(options.apiDir);
    if (!resourceMap || resourceMap.resources.length === 0) {
      const msg = `No .api-resources.yaml in ${options.apiDir}. Run 'zond refresh-api <name>' to (re)build it.`;
      if (options.json) printJson(jsonError("discover", [msg]));
      else printError(msg);
      return 2;
    }

    const envPath = options.envPath ?? join(options.apiDir, ".env.yaml");
    const env = (await loadEnvFile(envPath)) ?? {};
    const baseUrl = env["base_url"];
    if (!baseUrl) {
      const msg = `base_url is required in ${envPath} (live API calls need it).`;
      if (options.json) printJson(jsonError("discover", [msg]));
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
        printJson(jsonOk("discover", { items: [], message: "No path-FK dependencies with known owner resources." }));
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
          const idx = items.findIndex(i => i.varName === target.varName);
          if (idx >= 0) items[idx] = refreshed;
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
          // path-param (e.g. /audiences/{audience_id}). Resend-style APIs
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
    let unknownEnvKeys: string[] = [];
    if (manifest) {
      const manifestNames = new Set(manifest.fixtures.map(f => f.name));
      unknownEnvKeys = Object.keys(env).filter(k => !manifestNames.has(k));
    }

    const requiredManifestCount = manifest
      ? manifest.fixtures.filter(f => f.required).length
      : 0;
    const filledCount = items.filter(i => i.manifestStatus === "filled").length;

    if (options.json) {
      printJson(jsonOk("discover", {
        envPath,
        applied,
        backup: backupPath,
        items,
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
              stale: items.filter(i => i.status === "verify-stale").length,
              unknown: items.filter(i => i.status === "verify-unknown").length,
              skipped: items.filter(i => i.status === "verify-skip-empty" || i.status === "verify-no-read").length,
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
                    : (i.reason ?? ""),
      ]);
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
        console.log(`Verify summary: ${live} live, ${stale} stale, ${unknown} unknown.`);
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
    if (options.json) printJson(jsonError("discover", [message]));
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

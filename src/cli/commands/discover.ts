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
    | "miss-no-list"
    | "miss-nested-list"
    | "miss-no-owner"
    | "miss-network"
    | "miss-status"
    | "miss-empty"
    | "miss-no-id";
  reason?: string;
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
  return { resources: obj.resources ?? [] };
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
    resp = await executeRequest(
      { method: "GET", url, headers },
      { timeout: timeoutMs, retries: 0 },
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
        `no ${target.ownerResource} in target API — create one first (in the product UI ` +
        `or via API), then re-run discover`;
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

    const targets = collectTargets(resourceMap);
    if (targets.length === 0) {
      if (options.json) {
        printJson(jsonOk("discover", { items: [], message: "No path-FK dependencies with known owner resources." }));
      } else {
        console.log("No path-FK dependencies with known owner resources — nothing to discover.");
      }
      return 0;
    }

    // Probe each target sequentially — keeps load on the API low and the
    // diff readable. Discovery is a one-off pre-flight, not a hot loop.
    const items: DiscoveryItem[] = [];
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
        },
      }));
    } else {
      console.log(`Discovery against ${baseUrl} (${envPath}):`);
      console.log("");
      const cols = ["var", "resource", "list", "status", "value/reason"];
      const rows = items.map(i => [
        i.varName,
        i.resource,
        i.listPath || "—",
        i.status,
        i.status === "write"
          ? i.discovered!
          : i.status === "skip-already-set"
            ? `(kept: ${i.current})`
            : i.status === "skip-already-equal"
              ? `(unchanged: ${i.current})`
              : (i.reason ?? ""),
      ]);
      const widths = cols.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]!.length)));
      const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
      console.log(fmt(cols));
      console.log(widths.map(w => "─".repeat(w)).join("  "));
      for (const r of rows) console.log(fmt(r));
      console.log("");
      if (applied) {
        printSuccess(`Wrote ${writes.length} value(s) to ${envPath}` + (backupPath ? ` (backup: ${backupPath})` : ""));
      } else if (writes.length === 0) {
        console.log("Nothing to write (all targets already set or no discoveries succeeded).");
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

import type { Command } from "commander";
import { globalJson, resolveSpecArg } from "../resolve.ts";
import { parsePositiveInt } from "../argv.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByNameOrId } from "../../db/queries.ts";

export function registerDiscover(program: Command): void {
  program
    .command("discover")
    .description("Auto-fill .env.yaml FK ids by hitting list-endpoints (Phase 2.5 fixture pack — TASK-136)")
    .requiredOption("--api <name>", "Registered API to discover against (apis/<name>/.env.yaml)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--api-dir <path>", "Override apis/<name>/ root (defaults to the collection's base_dir)")
    .option("--env <path>", "Override .env.yaml path (defaults to <api-dir>/.env.yaml)")
    .option("--apply", "Write discovered values to .env.yaml (with .env.yaml.bak backup). Default: dry-run.")
    .option("--timeout <ms>", "Per-request timeout in ms (default 30000)", parsePositiveInt("--timeout"))
    .action(async (opts, cmd: Command) => {
      const resolved = resolveSpecArg(undefined, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      let apiDir = opts.apiDir as string | undefined;
      if (!apiDir) {
        try {
          getDb(opts.db);
          const col = findCollectionByNameOrId(opts.api);
          apiDir = col?.base_dir ?? `apis/${opts.api}`;
        } catch {
          apiDir = `apis/${opts.api}`;
        }
      }
      process.exitCode = await discoverCommand({
        specPath: resolved.spec,
        apiDir,
        envPath: opts.env,
        apply: opts.apply === true,
        timeoutMs: opts.timeout,
        json: globalJson(cmd),
      });
    });
}

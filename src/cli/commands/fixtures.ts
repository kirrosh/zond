/**
 * `zond fixtures` umbrella — manual fixture-bootstrap UX (ARV-195).
 *
 * Two subcommands today, both targeting the case `prepare-fixtures
 * --seed` cannot solve:
 *
 *   • `zond fixtures add <var>=<id> [--validate]`
 *       Set a fixture by hand. With `--validate` the command GETs the
 *       resource's read-by-id endpoint and classifies the value as
 *       `live` (200/2xx), `stale` (404), or `unknown` (no read endpoint
 *       wired or non-2xx/non-404 status).
 *
 *   • `zond fixtures import --from-curl`
 *       Paste a curl command (from a vendor dashboard / Chrome
 *       devtools) on stdin or via `--curl <text>`. The URL is matched
 *       against `apis/<name>/spec.json` paths; every `{var}` segment
 *       whose corresponding part of the URL is a literal id contributes
 *       a fixture. Reports the inferred map; with `--apply` writes it
 *       to `.env.yaml` (with .bak backup).
 *
 * Both commands target `apis/<name>/.env.yaml` resolved via the standard
 * --api / ZOND_API / .zond/current-api chain. They never touch the
 * manifest (.api-fixtures.yaml) — vars not in the manifest are still
 * written but flagged as `not in manifest, ignored` by the next
 * `prepare-fixtures` run, mirroring existing semantics.
 */
import type { Command } from "commander";
import { join } from "node:path";
import { copyFile } from "node:fs/promises";

import { getApi, MISSING_API_MESSAGE } from "../util/api-context.ts";
import { resolveApiCollection } from "../resolve.ts";
import { resolveCollectionSpec } from "../../core/setup-api.ts";
import { findCollectionByNameOrId } from "../../db/queries.ts";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../core/generator/index.ts";
import { computeAmbiguousPathParams, fixtureVarNameForPathParam } from "../../core/generator/suite-generator.ts";
import { liveAuthHeaders } from "../../core/probe/shared.ts";
import { isSoftDeletedBody } from "../../core/utils.ts";
import { readFixtureManifest, upsertEnvLine } from "./discover.ts";
import type { EndpointInfo } from "../../core/generator/types.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { printError, printSuccess } from "../output.ts";
import { globalJson } from "../resolve.ts";
import { executeRequest } from "../../core/runner/http-client.ts";
import { loadEnvFile } from "../../core/parser/variables.ts";

interface AddOptions {
  api?: string;
  validate?: boolean;
  apply?: boolean;
  json?: boolean;
}

interface ImportOptions {
  api?: string;
  fromCurl?: boolean;
  curl?: string;
  apply?: boolean;
  json?: boolean;
}

function resolveApiContext(
  cmd: Command,
  optsApi: string | undefined,
  json: boolean,
): { apiName: string; baseDir: string; specPath: string; envPath: string } | { error: string } {
  const apiName = getApi(cmd, { api: optsApi } as Record<string, unknown>);
  if (!apiName) return { error: MISSING_API_MESSAGE };
  const col = resolveApiCollection(apiName, undefined);
  if ("error" in col) return { error: col.error };
  if (!col.baseDir) return { error: `API '${apiName}' has no base_dir registered.` };
  if (!col.spec) return { error: `API '${apiName}' has no spec registered (run 'zond add api ... --spec ...').` };
  return {
    apiName,
    baseDir: col.baseDir,
    specPath: col.spec,
    envPath: join(col.baseDir, ".env.yaml"),
  };
}

async function readEnv(envPath: string): Promise<Record<string, string>> {
  return (await loadEnvFile(envPath)) ?? {};
}

export async function applyEnvWrites(
  envPath: string,
  writes: Record<string, string>,
): Promise<{ backup: string | null }> {
  const file = Bun.file(envPath);
  let text = (await file.exists()) ? await file.text() : "";
  let backup: string | null = `${envPath}.bak`;
  if (await file.exists()) {
    try { await copyFile(envPath, backup); } catch { backup = null; }
  } else {
    backup = null;
  }
  for (const [k, v] of Object.entries(writes)) {
    text = upsertEnvLine(text, k, v);
  }
  if (!text.endsWith("\n")) text += "\n";
  await Bun.write(envPath, text);
  return { backup };
}

/** ARV-424/423: resolve the read-by-id endpoint for a --validate readback via
 *  the fixture manifest's own affectedEndpoints (which carry the RAW path param,
 *  e.g. `{event_id}`) rather than re-deriving a `{k}` placeholder from the
 *  fixture's storage key (`events_event_id`) — the latter finds nothing for any
 *  namespaced/disambiguated var. Each path param resolves from its OWN env var;
 *  an empty SIBLING param is reported as such instead of being misattributed to
 *  the var under test (which would false-'stale' a genuinely-live id). */
type ReadbackResolution =
  | { kind: "url"; url: string; ep: EndpointInfo | undefined }
  | { kind: "stale-sibling"; sibling: string }
  | { kind: "no-endpoint" };

export function resolveReadbackEndpoint(
  k: string,
  v: string,
  affectedEndpoints: string[] | undefined,
  endpoints: EndpointInfo[],
  ambiguous: Set<string>,
  env: Record<string, string>,
  baseUrl: string,
): ReadbackResolution {
  const fromManifest = (affectedEndpoints ?? [])
    .find((l) => l.startsWith("GET "))?.slice(4).trim();
  const path = fromManifest
    ?? endpoints.find((e) => e.method.toUpperCase() === "GET" && e.path.includes(`{${k}}`) && !e.deprecated)?.path;
  if (!path) return { kind: "no-endpoint" };

  let staleSibling: string | null = null;
  const filled = path.replace(/\{([^}]+)\}/g, (_m, param: string) => {
    const varForParam = fixtureVarNameForPathParam(path, param, ambiguous);
    const isTarget = varForParam === k || param === k;
    const val = isTarget ? v : (env[varForParam] ?? env[param]);
    if (!isTarget && (val === undefined || val === "")) staleSibling ??= varForParam;
    return val === undefined || val === "" ? `{${param}}` : encodeURIComponent(val);
  });
  if (staleSibling) return { kind: "stale-sibling", sibling: staleSibling };
  const ep = endpoints.find((e) => e.method.toUpperCase() === "GET" && e.path === path);
  return { kind: "url", url: `${baseUrl.replace(/\/+$/, "")}${filled}`, ep };
}

async function addAction(
  pairs: string[],
  cmd: Command,
): Promise<void> {
  const opts = cmd.opts<AddOptions>();
  const json = opts.json === true || globalJson(cmd);
  const ctx = resolveApiContext(cmd, opts.api, json);
  if ("error" in ctx) {
    if (json) printJson(jsonError("fixtures add", [ctx.error]));
    else printError(ctx.error);
    process.exit(2);
    return;
  }

  // Parse "var=value" pairs from positionals.
  const writes: Record<string, string> = {};
  for (const raw of pairs) {
    const idx = raw.indexOf("=");
    if (idx <= 0) {
      const m = `Invalid fixture '${raw}' — expected 'var=value'`;
      if (json) printJson(jsonError("fixtures add", [m])); else printError(m);
      process.exit(2);
      return;
    }
    writes[raw.slice(0, idx).trim()] = raw.slice(idx + 1);
  }
  if (Object.keys(writes).length === 0) {
    const m = "No fixtures supplied. Usage: zond fixtures add <var>=<value> [<var>=<value> ...]";
    if (json) printJson(jsonError("fixtures add", [m])); else printError(m);
    process.exit(2);
    return;
  }

  // ARV-32: optional read-by-id validate per fixture.
  type Validation = { var: string; status: "live" | "stale" | "unknown"; httpStatus?: number; reason?: string };
  const validations: Validation[] = [];
  if (opts.validate) {
    const env = await readEnv(ctx.envPath);
    const baseUrl = env.base_url;
    if (!baseUrl) {
      const m = "Cannot --validate: base_url not set in .env.yaml.";
      if (json) printJson(jsonError("fixtures add", [m])); else printError(m);
      process.exit(2);
      return;
    }
    // ARV-417: derive auth headers the same way every other live-call path
    // does (liveAuthHeaders) instead of firing an anonymous GET — on any authed
    // API a hand-built header-less request 401s and a genuinely-live fixture
    // reads back as 'unknown' (or false-'stale').
    const doc = await readOpenApiSpec(ctx.specPath);
    const endpoints = extractEndpoints(doc);
    const schemes = extractSecuritySchemes(doc);
    const ambiguous = computeAmbiguousPathParams(endpoints);
    const manifest = await readFixtureManifest(ctx.baseDir);
    const manifestByName = new Map((manifest?.fixtures ?? []).map((f) => [f.name, f] as const));
    for (const [k, v] of Object.entries(writes)) {
      const res = resolveReadbackEndpoint(
        k, v, manifestByName.get(k)?.affectedEndpoints, endpoints, ambiguous, env, baseUrl,
      );
      if (res.kind === "no-endpoint") {
        validations.push({ var: k, status: "unknown", reason: "no GET endpoint for {" + k + "} in manifest affectedEndpoints or spec" });
        continue;
      }
      if (res.kind === "stale-sibling") {
        // ARV-423: don't blame k for a sibling path-var that's empty/stale.
        validations.push({ var: k, status: "unknown", reason: `blocked by stale sibling {${res.sibling}} — resolve it first, then re-validate {${k}}` });
        continue;
      }
      try {
        const resp = await executeRequest(
          { method: "GET", url: res.url, headers: { accept: "application/json", ...(res.ep ? liveAuthHeaders(res.ep, schemes, env) : {}) } },
          { timeout: 10_000, retries: 0, network_retries: 1 },
        );
        if (resp.status >= 200 && resp.status < 300) {
          // ARV-418: HTTP 200 + top-level `deleted: true` is a soft-delete stub
          // (Stripe et al.), not a live resource.
          if (isSoftDeletedBody(resp.body_parsed)) {
            validations.push({ var: k, status: "stale", httpStatus: resp.status, reason: "soft-deleted (body deleted:true)" });
          } else {
            validations.push({ var: k, status: "live", httpStatus: resp.status });
          }
        } else if (resp.status === 404) {
          validations.push({ var: k, status: "stale", httpStatus: 404 });
        } else {
          validations.push({ var: k, status: "unknown", httpStatus: resp.status, reason: `non-2xx/non-404 status` });
        }
      } catch (err) {
        validations.push({ var: k, status: "unknown", reason: (err as Error).message });
      }
    }
  }

  let backup: string | null = null;
  if (opts.apply) {
    const result = await applyEnvWrites(ctx.envPath, writes);
    backup = result.backup;
  }

  if (json) {
    printJson(jsonOk("fixtures add", {
      api: ctx.apiName,
      env: ctx.envPath,
      writes,
      applied: opts.apply === true,
      backup,
      validations,
    }));
  } else {
    if (opts.apply) {
      printSuccess(`Wrote ${Object.keys(writes).length} fixture(s) to ${ctx.envPath}` + (backup ? ` (backup: ${backup})` : ""));
    } else {
      printSuccess(`Dry-run — pass --apply to write to ${ctx.envPath}`);
    }
    for (const [k, v] of Object.entries(writes)) {
      const val = validations.find((x) => x.var === k);
      const tag = val ? `  [${val.status}${val.httpStatus ? " " + val.httpStatus : ""}]${val.reason ? " — " + val.reason : ""}` : "";
      console.log(`  ${k} = ${v}${tag}`);
    }
  }
  process.exit(0);
}

/** Strip the `curl` invocation down to the URL. Handles `-X METHOD`,
 *  `-H 'Header: v'`, `--data ...`, etc. — we only need the URL here. */
export function extractUrlFromCurl(curl: string): string | null {
  const cleaned = curl.replace(/\\\n/g, " ").trim();
  // Tokens are space-delimited, but URL values may be quoted. Walk the
  // string with a small state machine so we honour single/double quotes.
  const tokens: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch as '"' | "'"; continue; }
    if (/\s/.test(ch)) {
      if (buf) tokens.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) tokens.push(buf);

  // First token starting with http(s):// is the URL. Curl also accepts
  // `--url <url>` and `-:` syntax; stay conservative and just look for
  // a URL-shaped token.
  for (const t of tokens) {
    if (/^https?:\/\//i.test(t)) return t;
  }
  return null;
}

/** Match a concrete URL path against spec path templates and extract
 *  `{var}` → value bindings. Returns the bindings of the FIRST template
 *  that matches the whole path, or empty when nothing matches. */
export function extractFixturesFromPath(
  url: string,
  specPaths: string[],
): { matchedTemplate: string; bindings: Record<string, string> } | null {
  let pathname: string;
  try { pathname = new URL(url).pathname; } catch { return null; }
  // Sort longest-first so a 3-segment template wins over a 1-segment one.
  const sorted = [...specPaths].sort((a, b) => b.split("/").length - a.split("/").length);
  for (const tpl of sorted) {
    const tplSegs = tpl.split("/").filter(Boolean);
    const urlSegs = pathname.split("/").filter(Boolean);
    if (tplSegs.length !== urlSegs.length) continue;
    const bindings: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < tplSegs.length; i++) {
      const ts = tplSegs[i]!;
      const us = urlSegs[i]!;
      const m = ts.match(/^\{([^}]+)\}$/);
      if (m) {
        try { bindings[m[1]!] = decodeURIComponent(us); } catch { bindings[m[1]!] = us; }
      } else if (ts !== us) {
        ok = false;
        break;
      }
    }
    if (ok) return { matchedTemplate: tpl, bindings };
  }
  return null;
}

async function importAction(cmd: Command): Promise<void> {
  const opts = cmd.opts<ImportOptions>();
  const json = opts.json === true || globalJson(cmd);
  const ctx = resolveApiContext(cmd, opts.api, json);
  if ("error" in ctx) {
    if (json) printJson(jsonError("fixtures import", [ctx.error]));
    else printError(ctx.error);
    process.exit(2);
    return;
  }
  if (opts.fromCurl !== true) {
    const m = "Required: --from-curl. (Other importers can be added later.)";
    if (json) printJson(jsonError("fixtures import", [m])); else printError(m);
    process.exit(2);
    return;
  }

  let curl = opts.curl;
  if (!curl) {
    // Read from stdin so the user can `pbpaste | zond fixtures import --from-curl`.
    curl = (await Bun.stdin.text()).trim();
  }
  if (!curl || curl.length === 0) {
    const m = "No curl input — pipe a 'curl ...' command on stdin or pass --curl '<text>'.";
    if (json) printJson(jsonError("fixtures import", [m])); else printError(m);
    process.exit(2);
    return;
  }

  const url = extractUrlFromCurl(curl);
  if (!url) {
    const m = "Could not extract a URL from the curl input.";
    if (json) printJson(jsonError("fixtures import", [m])); else printError(m);
    process.exit(2);
    return;
  }

  const doc = await readOpenApiSpec(ctx.specPath);
  const specPaths = Object.keys(doc.paths ?? {});
  const match = extractFixturesFromPath(url, specPaths);
  if (!match || Object.keys(match.bindings).length === 0) {
    const m = `URL '${url}' did not match any path template in the spec, or had no {var} bindings.`;
    if (json) printJson(jsonError("fixtures import", [m])); else printError(m);
    process.exit(2);
    return;
  }

  let backup: string | null = null;
  if (opts.apply) {
    const result = await applyEnvWrites(ctx.envPath, match.bindings);
    backup = result.backup;
  }

  if (json) {
    printJson(jsonOk("fixtures import", {
      api: ctx.apiName,
      env: ctx.envPath,
      source: { kind: "curl", url, matchedTemplate: match.matchedTemplate },
      writes: match.bindings,
      applied: opts.apply === true,
      backup,
    }));
  } else {
    if (opts.apply) {
      printSuccess(`Imported ${Object.keys(match.bindings).length} fixture(s) from curl URL`);
      console.log(`  source: ${url}`);
      console.log(`  matched: ${match.matchedTemplate}`);
      console.log(`  wrote to: ${ctx.envPath}` + (backup ? ` (backup: ${backup})` : ""));
    } else {
      printSuccess(`Dry-run — pass --apply to write to ${ctx.envPath}`);
      console.log(`  matched: ${match.matchedTemplate}`);
    }
    for (const [k, v] of Object.entries(match.bindings)) {
      console.log(`  ${k} = ${v}`);
    }
  }
  process.exit(0);
}

export function registerFixtures(program: Command): void {
  const fixtures = program
    .command("fixtures")
    .description("Manual fixture-bootstrap helpers (ARV-195) — `add` and `import`. Complements `zond prepare-fixtures` for the cases auto-discover/--seed cannot solve (path-FK ids hidden in vendor dashboards, manual sandbox setup).");

  fixtures
    .command("add <pairs...>")
    .description("Set one or more fixtures: 'var=value'. Optionally validate by GETing the spec's read-by-id endpoint for the var.")
    .option("--api <name>", "Registered API (apis/<name>/.env.yaml). Falls back to ZOND_API / .zond/current-api.")
    .option("--validate", "GET the resource's read-by-id endpoint and classify each value as live/stale/unknown.")
    .option("--apply", "Write the fixtures to .env.yaml (with .env.yaml.bak backup). Default: dry-run.")
    .action(async (pairs: string[], _opts, cmd: Command) => {
      await addAction(pairs, cmd);
    });

  fixtures
    .command("import")
    .description("Import fixtures from an external source. Today: --from-curl (paste a curl command from a vendor dashboard / Chrome devtools).")
    .option("--api <name>", "Registered API (apis/<name>/.env.yaml). Falls back to ZOND_API / .zond/current-api.")
    .option("--from-curl", "Treat input as a curl command. Reads from stdin or --curl <text>.")
    .option("--curl <text>", "Inline curl command (alternative to stdin).")
    .option("--apply", "Write the inferred fixtures to .env.yaml (with .env.yaml.bak backup). Default: dry-run.")
    .action(async (_opts, cmd: Command) => {
      await importAction(cmd);
    });
}

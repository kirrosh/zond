/**
 * `zond bootstrap` — one-shot setup of an empty workspace until `.env.yaml`
 * has enough FK fixtures to run generated tests (TASK-261).
 *
 * The shape of the problem: `zond discover` already fills FK ids from
 * list-endpoints, but only when their parent fixtures are present. On a
 * fresh workspace nearly every FK is nested (`/orgs/{org}/projects/`,
 * `/projects/{org}/{proj}/keys/` ...) so a single discover pass quits with
 * `miss-nested-list` for ~80% of vars. Bootstrap closes that loop:
 *
 *   1. cascade discover — repeat until no new fixtures land in a pass;
 *   2. (optional) seed — for vars discover couldn't satisfy (empty list,
 *      list-only owner with no element to grab), POST a generated body to
 *      the resource's `create` endpoint, capture the id, write it back;
 *   3. final discover sweep — children of seeded parents.
 *
 * Idempotent by construction: `discover`'s "skip-already-set" logic means
 * a re-run with the same env is a no-op for filled vars unless `--force`
 * is passed. Seeds aren't re-attempted when their owner var is already
 * filled — natural deduplication without a state file.
 */

import { join } from "path";
import { copyFile } from "fs/promises";
import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
} from "../../core/generator/index.ts";
import { generateFromSchema } from "../../core/generator/data-factory.ts";
import { loadEnvFile, substituteDeep } from "../../core/parser/variables.ts";
import { liveAuthHeaders } from "../../core/probe/shared.ts";
import { executeRequest } from "../../core/runner/http-client.ts";
import {
  collectTargets,
  isPlaceholder,
  probeOne,
  readResourceMap,
  upsertEnvLine,
  type DiscoveryItem,
  type FkTarget,
  type ResourceYaml,
} from "./discover.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import type { EndpointInfo, SecuritySchemeInfo } from "../../core/generator/types.ts";

export interface BootstrapOptions {
  specPath: string;
  apiDir: string;
  envPath?: string;
  apply?: boolean;
  /** Re-create seed resources / re-fetch ids even when the var is filled. */
  force?: boolean;
  /** POST to create endpoints when discover can't find an existing record. */
  seed?: boolean;
  timeoutMs?: number;
  /** Hard cap on cascade passes — defends against pathological loops. */
  maxPasses?: number;
  json?: boolean;
}

interface SeedAttempt {
  varName: string;
  resource: string;
  createPath: string;
  status: "seeded" | "skip-already-set" | "skip-no-create" | "skip-no-schema" | "miss-network" | "miss-status" | "miss-no-id";
  capturedId?: string;
  reason?: string;
}

interface Pass {
  index: number;
  items: DiscoveryItem[];
  newWrites: string[];
}

function parseEndpointLabel(label: string): { method: string; path: string } | null {
  const parts = label.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return { method: parts[0]!.toUpperCase(), path: parts[1]! };
}

/** Vars whose value is currently a real fixture (non-empty, non-TODO). */
function nonEmptyVars(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string" && !isPlaceholder(v)) out[k] = v;
  }
  return out;
}

/** Pick the response field that matches `captureField`/common id fallbacks. */
function captureFromResponse(body: unknown, preferred: string): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  // Some APIs wrap created entities in { data: { ... } }.
  let payload: Record<string, unknown> = body as Record<string, unknown>;
  for (const wrapper of ["data", "result", "item"]) {
    if (
      payload[wrapper] &&
      typeof payload[wrapper] === "object" &&
      !Array.isArray(payload[wrapper])
    ) {
      payload = payload[wrapper] as Record<string, unknown>;
      break;
    }
  }
  const tryKey = (k: string): string | undefined => {
    const v = payload[k];
    if (typeof v === "string" || typeof v === "number") return String(v);
    return undefined;
  };
  return (
    tryKey(preferred) ?? tryKey("id") ?? tryKey("slug") ?? tryKey("uuid") ?? tryKey("key") ?? tryKey("name")
  );
}

/** Resolve the resource record that *creates* `varName` — i.e. the resource
 *  whose `idParam` matches the var, with a `create` endpoint. */
function findOwnerResourceForSeed(
  varName: string,
  resources: ResourceYaml[],
): ResourceYaml | undefined {
  // Strategy 1: idParam matches exactly.
  let owner = resources.find(r => r.idParam === varName && r.endpoints?.create);
  if (owner) return owner;
  // Strategy 2: another resource references `varName` via fkDependencies and
  // names its ownerResource. Look that up.
  for (const r of resources) {
    for (const dep of r.fkDependencies ?? []) {
      if (dep.var === varName && dep.ownerResource) {
        owner = resources.find(x => x.resource === dep.ownerResource && x.endpoints?.create);
        if (owner) return owner;
      }
    }
  }
  return undefined;
}

/** Substitute path-params in a path with values from vars. Returns
 *  `{ resolved, missing }`; missing is non-empty when a parent fixture is
 *  still absent — caller defers the seed for a later cascade pass. */
function resolvePath(path: string, vars: Record<string, string>): { resolved: string; missing: string[] } {
  const missing: string[] = [];
  const resolved = path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const v = vars[name];
    if (typeof v === "string" && v) return v;
    missing.push(name);
    return `{${name}}`;
  });
  return { resolved, missing };
}

async function trySeed(
  varName: string,
  resources: ResourceYaml[],
  endpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
  baseUrl: string,
  timeoutMs: number,
): Promise<SeedAttempt> {
  const owner = findOwnerResourceForSeed(varName, resources);
  if (!owner || !owner.endpoints?.create) {
    return {
      varName,
      resource: owner?.resource ?? "?",
      createPath: "",
      status: "skip-no-create",
      reason: `no resource with create endpoint produces ${varName}`,
    };
  }
  const parsed = parseEndpointLabel(owner.endpoints.create);
  if (!parsed) {
    return { varName, resource: owner.resource, createPath: "", status: "skip-no-create", reason: `unparsable label ${owner.endpoints.create}` };
  }
  const ep = endpoints.find(
    e => e.method.toUpperCase() === parsed.method && e.path === parsed.path && !e.deprecated,
  );
  if (!ep) {
    return { varName, resource: owner.resource, createPath: parsed.path, status: "skip-no-create", reason: `${parsed.method} ${parsed.path} not in spec` };
  }
  if (!ep.requestBodySchema) {
    return { varName, resource: owner.resource, createPath: parsed.path, status: "skip-no-schema", reason: `no requestBodySchema on ${parsed.method} ${parsed.path}` };
  }
  const { resolved: pathResolved, missing } = resolvePath(parsed.path, vars);
  if (missing.length > 0) {
    return {
      varName,
      resource: owner.resource,
      createPath: parsed.path,
      status: "skip-no-create",
      reason: `parent fixtures missing for create path: ${missing.join(", ")}`,
    };
  }
  const generated = generateFromSchema(ep.requestBodySchema, undefined, { forRequest: true });
  // Resolve `{{$randomSlug}}` etc. into concrete values for the live POST.
  const concreteBody = substituteDeep(generated, vars);

  const url = `${baseUrl.replace(/\/+$/, "")}${pathResolved}`;
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": ep.requestBodyContentType ?? "application/json",
    ...liveAuthHeaders(ep, schemes, vars),
  };

  let resp;
  try {
    resp = await executeRequest(
      { method: parsed.method, url, headers, body: JSON.stringify(concreteBody) },
      { timeout: timeoutMs, retries: 0 },
    );
  } catch (err) {
    return {
      varName,
      resource: owner.resource,
      createPath: parsed.path,
      status: "miss-network",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  if (resp.status < 200 || resp.status >= 300) {
    return {
      varName,
      resource: owner.resource,
      createPath: parsed.path,
      status: "miss-status",
      reason: `${parsed.method} ${pathResolved} → ${resp.status}`,
    };
  }
  const captured = captureFromResponse(
    resp.body_parsed ?? resp.body,
    owner.captureField || "id",
  );
  if (captured === undefined) {
    return {
      varName,
      resource: owner.resource,
      createPath: parsed.path,
      status: "miss-no-id",
      reason: `response had no extractable ${owner.captureField || "id"}`,
    };
  }
  return {
    varName,
    resource: owner.resource,
    createPath: parsed.path,
    status: "seeded",
    capturedId: captured,
  };
}

interface BootstrapResult {
  passes: Pass[];
  seeds: SeedAttempt[];
  finalEnv: Record<string, string>;
  writes: Map<string, string>;
}

/** TASK-271: explicit reason the cascade stopped iterating, surfaced in the
 *  summary so users can tell `nothing-to-do` apart from `we ran out of
 *  budget`. */
export type CascadeStopReason = "stable" | "max-passes" | "no-targets";

async function runCascade(
  targets: FkTarget[],
  endpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
  env: Record<string, string>,
  baseUrl: string,
  timeoutMs: number,
  maxPasses: number,
  writes: Map<string, string>,
  passesOut: Pass[],
  startIndex: number,
): Promise<CascadeStopReason> {
  for (let pass = 0; pass < maxPasses; pass++) {
    const items: DiscoveryItem[] = [];
    const newWrites: string[] = [];
    for (const target of targets) {
      const current = env[target.varName];
      if (!isPlaceholder(current)) continue;
      const item = await probeOne(target, current, endpoints, schemes, env, baseUrl, timeoutMs);
      items.push(item);
      if (item.status === "write" && item.discovered) {
        env[target.varName] = item.discovered;
        writes.set(target.varName, item.discovered);
        newWrites.push(target.varName);
      }
    }
    passesOut.push({ index: startIndex + pass, items, newWrites });
    if (newWrites.length === 0) return "stable";
  }
  return "max-passes";
}

export async function bootstrapCommand(options: BootstrapOptions): Promise<number> {
  try {
    const doc = await readOpenApiSpec(options.specPath);
    const endpoints = extractEndpoints(doc);
    const schemes = extractSecuritySchemes(doc);

    const resourceMap = await readResourceMap(options.apiDir);
    if (!resourceMap || resourceMap.resources.length === 0) {
      const msg = `No .api-resources.yaml in ${options.apiDir}. Run 'zond refresh-api ${options.apiDir.split("/").pop()}' first.`;
      if (options.json) printJson(jsonError("bootstrap", [msg]));
      else printError(msg);
      return 2;
    }

    const envPath = options.envPath ?? join(options.apiDir, ".env.yaml");
    const env = (await loadEnvFile(envPath)) ?? {};
    const baseUrl = env["base_url"];
    if (!baseUrl) {
      const msg = `base_url is required in ${envPath} (live API calls need it).`;
      if (options.json) printJson(jsonError("bootstrap", [msg]));
      else printError(msg);
      return 2;
    }

    const timeout = options.timeoutMs ?? 30000;
    const maxPasses = options.maxPasses ?? 8;
    const targets = collectTargets(resourceMap);

    if (targets.length === 0 && !options.seed) {
      const msg = "No path-FK dependencies — nothing to bootstrap.";
      if (options.json) {
        printJson(jsonOk("bootstrap", { envPath, applied: false, passes: [], seeds: [], summary: { writes: 0, seeds: 0 } }));
      } else {
        console.log(msg);
      }
      return 0;
    }

    // --force erases existing values so the cascade revisits them.
    if (options.force) {
      for (const t of targets) env[t.varName] = "";
    }

    // Snapshot which vars were already filled before any discover/seed. We
    // need this for per-target classification (`already` vs `discovered`).
    const preFilled = new Set(targets.filter(t => !isPlaceholder(env[t.varName])).map(t => t.varName));

    const writes = new Map<string, string>();
    const passes: Pass[] = [];
    let lastCascadeStop: CascadeStopReason = "no-targets";
    if (targets.length > 0) {
      lastCascadeStop = await runCascade(targets, endpoints, schemes, env, baseUrl, timeout, maxPasses, writes, passes, 1);
    }

    const seeds: SeedAttempt[] = [];
    let seedStop: "stable" | "max-passes" | "no-progress" | "not-run" = "not-run";
    if (options.seed) {
      // Two-phase seed: a seed unlocks parents, which can let cascade fill
      // children in the next pass. We loop seed→cascade until either
      // (a) no remaining empty FK has a viable owner, or (b) no progress
      // is made — whichever comes first.
      let outer = 0;
      for (; outer < maxPasses; outer++) {
        const stillEmpty = targets.filter(t => isPlaceholder(env[t.varName]));
        if (stillEmpty.length === 0) { seedStop = "stable"; break; }

        let progressed = false;
        for (const t of stillEmpty) {
          const owner = findOwnerResourceForSeed(t.varName, resourceMap.resources);
          if (!owner) continue;
          const attempt = await trySeed(
            t.varName,
            resourceMap.resources,
            endpoints,
            schemes,
            nonEmptyVars(env),
            baseUrl,
            timeout,
          );
          seeds.push(attempt);
          if (attempt.status === "seeded" && attempt.capturedId) {
            env[t.varName] = attempt.capturedId;
            writes.set(t.varName, attempt.capturedId);
            progressed = true;
          }
        }
        if (!progressed) { seedStop = "no-progress"; break; }
        // After seeding parents, give cascade another go for nested children.
        lastCascadeStop = await runCascade(targets, endpoints, schemes, env, baseUrl, timeout, maxPasses, writes, passes, passes.length + 1);
      }
      if (outer >= maxPasses) seedStop = "max-passes";
    }

    let applied = false;
    let backupPath: string | null = null;
    if (options.apply && writes.size > 0) {
      backupPath = `${envPath}.bak`;
      try {
        await copyFile(envPath, backupPath);
      } catch {
        backupPath = null;
      }
      const file = Bun.file(envPath);
      let text = (await file.exists()) ? await file.text() : "";
      for (const [k, v] of writes) {
        text = upsertEnvLine(text, k, v);
      }
      if (!text.endsWith("\n")) text += "\n";
      await Bun.write(envPath, text);
      applied = true;
    }

    const totalFkVars = targets.length;
    const filledFkVars = targets.filter(t => !isPlaceholder(env[t.varName])).length;
    const fillRate = totalFkVars === 0 ? 1 : filledFkVars / totalFkVars;

    // TASK-271: per-target classification — `already` (was filled at start),
    // `discovered` (cascade list-endpoint pulled an id), `seeded` (POST-create
    // seeded a parent and we captured its id), `failed:<reason>` (still empty
    // — surface why so the operator knows where to step in by hand).
    type TargetStatus = "already" | "discovered" | "seeded" | `failed:${string}`;
    const perTarget: Array<{ var: string; resource: string; status: TargetStatus; value?: string; reason?: string }> = [];
    for (const t of targets) {
      const value = env[t.varName];
      let status: TargetStatus;
      let reason: string | undefined;
      if (preFilled.has(t.varName) && !options.force) {
        status = "already";
      } else if (!isPlaceholder(value)) {
        const seeded = seeds.find(s => s.varName === t.varName && s.status === "seeded");
        status = seeded ? "seeded" : "discovered";
      } else {
        // Still empty — pick the most recent miss-* item from the cascade as
        // the reason; fallback to the seed attempt's reason.
        const lastItem = [...passes].reverse()
          .flatMap(p => p.items)
          .find(i => i.varName === t.varName);
        if (lastItem) {
          reason = lastItem.reason ?? lastItem.status;
          status = `failed:${lastItem.status}`;
        } else {
          const lastSeed = [...seeds].reverse().find(s => s.varName === t.varName);
          if (lastSeed) {
            reason = lastSeed.reason ?? lastSeed.status;
            status = `failed:${lastSeed.status}`;
          } else {
            reason = "no list endpoint and no create endpoint to seed from";
            status = "failed:no-route";
          }
        }
      }
      perTarget.push({ var: t.varName, resource: t.ownerResource, status, ...(isPlaceholder(value) ? {} : { value }), ...(reason ? { reason } : {}) });
    }

    const noOp = totalFkVars > 0 && filledFkVars === totalFkVars && writes.size === 0 && seeds.length === 0;
    const mode: "exec" | "plan" = options.apply ? "exec" : "plan";

    if (options.json) {
      printJson(jsonOk("bootstrap", {
        envPath,
        applied,
        mode,
        backup: backupPath,
        passes: passes.map(p => ({ pass: p.index, writes: p.newWrites, items: p.items })),
        seeds,
        perTarget,
        summary: {
          targets: totalFkVars,
          filled: filledFkVars,
          fillRate: Number(fillRate.toFixed(2)),
          writes: writes.size,
          seedsAttempted: seeds.length,
          seedsSucceeded: seeds.filter(s => s.status === "seeded").length,
          passes: passes.length,
          cascadeStop: lastCascadeStop,
          ...(options.seed ? { seedStop } : {}),
          noOp,
        },
      }));
    } else {
      const tag = mode === "exec" ? "[exec]" : "[plan]";
      console.log(`${tag} Bootstrap against ${baseUrl} (${envPath})`);
      console.log("");

      if (noOp) {
        console.log(`bootstrap: nothing to do — ${filledFkVars}/${totalFkVars} fixtures already present.`);
      } else {
        // Per-target table.
        if (perTarget.length > 0) {
          console.log("Fixture status:");
          for (const r of perTarget) {
            const head = r.status.padEnd(20);
            const value = r.value !== undefined ? `→ ${r.value}` : "";
            const reason = r.reason ? ` (${r.reason})` : "";
            console.log(`  ${head} ${r.var.padEnd(28)} ${r.resource.padEnd(20)} ${value}${reason}`);
          }
          console.log("");
        }
        for (const p of passes) {
          console.log(`Pass ${p.index}: ${p.newWrites.length} new fixture(s)${p.newWrites.length ? ` — ${p.newWrites.join(", ")}` : ""}`);
        }
        if (passes.length > 0) {
          console.log(`Cascade stopped after ${passes.length} pass(es): ${lastCascadeStop}.`);
        }
        if (seeds.length > 0) {
          console.log("");
          console.log("Seed attempts:");
          for (const s of seeds) {
            const tail = s.status === "seeded" ? `→ ${s.capturedId}` : `(${s.reason ?? ""})`;
            console.log(`  ${s.status.padEnd(18)} ${s.varName.padEnd(28)} ${s.resource.padEnd(20)} ${tail}`);
          }
          console.log(`Seed loop stopped: ${seedStop}.`);
        }
        console.log("");
        console.log(`Filled ${filledFkVars}/${totalFkVars} path-FK vars (${Math.round(fillRate * 100)}%).`);
      }

      if (applied) {
        printSuccess(`Wrote ${writes.size} value(s) to ${envPath}` + (backupPath ? ` (backup: ${backupPath})` : ""));
      } else if (writes.size === 0) {
        if (!noOp) console.log("Nothing to write (cascade/seed produced no new values).");
      } else {
        printWarning(`[plan] ${writes.size} value(s) ready. Re-run with --apply to write ${envPath}.`);
      }
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) printJson(jsonError("bootstrap", [message]));
    else printError(message);
    return 2;
  }
}

import type { Command } from "commander";
import { globalJson, resolveSpecArg } from "../resolve.ts";
import { parsePositiveInt } from "../argv.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByNameOrId } from "../../db/queries.ts";

export function registerBootstrap(program: Command): void {
  program
    .command("bootstrap")
    .description("One-shot setup: cascade-discover + (optional) --seed POSTs (TASK-261)")
    .requiredOption("--api <name>", "Registered API to bootstrap (apis/<name>/.env.yaml)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--api-dir <path>", "Override apis/<name>/ root")
    .option("--env <path>", "Override .env.yaml path")
    .option("--apply", "Write discovered + seeded values to .env.yaml. Default: dry-run.")
    .option("--seed", "POST to create endpoints when discover can't find an existing record")
    .option("--force", "Re-discover/re-seed even if a fixture is already filled (overwrites)")
    .option("--timeout <ms>", "Per-request timeout in ms (default 30000)", parsePositiveInt("--timeout"))
    .option("--max-passes <n>", "Cap on cascade passes (default 8)", parsePositiveInt("--max-passes"))
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
      process.exitCode = await bootstrapCommand({
        specPath: resolved.spec,
        apiDir,
        envPath: opts.env,
        apply: opts.apply === true,
        seed: opts.seed === true,
        force: opts.force === true,
        timeoutMs: opts.timeout,
        maxPasses: opts.maxPasses,
        json: globalJson(cmd),
      });
    });
}

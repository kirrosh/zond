/**
 * `zond cleanup` — retry housekeeping that probes couldn't finish.
 *
 * v1 ships only `--orphans`: read every record from
 * `~/.zond/orphans/<api>/<run-id>.jsonl` and re-issue the DELETE for any
 * resource that survived the probe's own cleanup attempts. 404 is treated
 * as success — the goal is "resource is gone", and the API getting there
 * before us is fine. (TASK-278.)
 */
import { loadOrphans, markRemoved } from "../../core/probe/orphan-tracker.ts";
import type { OrphanRecord } from "../../core/probe/orphan-tracker.ts";
import { executeRequest } from "../../core/runner/http-client.ts";
import { loadEnvironment, loadEnvMeta } from "../../core/parser/variables.ts";
import { resolveTimeoutMs } from "../../core/workspace/config.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { printError, printWarning, printSuccess } from "../output.ts";
import type { Command } from "commander";
import { globalJson } from "../resolve.ts";

export interface CleanupOptions {
  orphans: boolean;
  api?: string;
  runId?: string;
  dryRun?: boolean;
  json?: boolean;
  /** Override base_url resolution. By default the env from cwd .env.yaml or
   *  apis/<api>/.env.yaml is used. Tests inject a known URL via this. */
  baseUrl?: string;
  /** Per-request timeout, ms. */
  timeoutMs?: number;
}

export async function cleanupCommand(opts: CleanupOptions): Promise<number> {
  if (!opts.orphans) {
    const m = "Nothing to do — pass --orphans to retry leaked probe resources.";
    if (opts.json) printJson(jsonError("cleanup", [m]));
    else printError(m);
    return 2;
  }

  let records: OrphanRecord[];
  try {
    const filter: { api?: string; runId?: string } = {};
    if (opts.api) filter.api = opts.api;
    if (opts.runId) filter.runId = opts.runId;
    records = await loadOrphans(filter);
  } catch (err) {
    const m = `Failed to load orphan tracker: ${(err as Error).message}`;
    if (opts.json) printJson(jsonError("cleanup", [m]));
    else printError(m);
    return 2;
  }

  // ARV-102 (F7): split orphans into retriable (have a DELETE plan) and
  // manual-only (probe knew the resource was created but couldn't derive
  // a deletePath / id). Manual-only entries are surfaced separately —
  // we can't auto-DELETE them, but the operator must know they exist.
  const manualOnly = records.filter(r => r.requires_manual_cleanup === true || r.deletePath === "");
  const retriable = records.filter(r => !(r.requires_manual_cleanup === true || r.deletePath === ""));

  if (records.length === 0) {
    if (opts.json) printJson(jsonOk("cleanup", { retried: 0, removed: 0, failed: 0, items: [], manual_cleanup_required: [] }));
    else console.log("No orphan resources to retry.");
    return 0;
  }

  // Group by api so we resolve env once per API instead of per record.
  const baseUrlByApi = new Map<string, string>();
  if (opts.baseUrl) {
    for (const r of retriable) baseUrlByApi.set(r.api, opts.baseUrl);
  }

  if (opts.dryRun) {
    if (opts.json) printJson(jsonOk("cleanup", { dryRun: true, items: retriable, manual_cleanup_required: manualOnly }));
    else {
      console.log(`Dry-run: ${retriable.length} orphan(s) would be retried:`);
      for (const r of retriable) {
        console.log(`  ${r.method} ${r.path} (id=${r.id}); DELETE ${r.deletePath} — last status: ${r.lastCleanupStatus ?? "n/a"}`);
      }
      if (manualOnly.length > 0) {
        console.log(`\nManual cleanup required: ${manualOnly.length} resource(s) (no DELETE plan):`);
        for (const r of manualOnly) {
          console.log(`  ${r.method} ${r.path}${r.id ? ` (id=${r.id})` : ""} — ${r.lastCleanupError ?? "no DELETE counterpart"}`);
        }
      }
    }
    return 0;
  }

  // Per-API timeout: CLI flag → apis/<api>/.env.yaml `timeoutMs:` → workspace
  // `defaults.timeout_ms` → 30000.
  const timeoutByApi = new Map<string, number>();
  async function timeoutFor(api: string): Promise<number> {
    let t = timeoutByApi.get(api);
    if (t !== undefined) return t;
    let envTimeout: number | undefined;
    try {
      const meta = await loadEnvMeta(undefined, `apis/${api}`);
      envTimeout = meta.timeoutMs;
    } catch { /* meta is best-effort */ }
    t = resolveTimeoutMs(opts.timeoutMs, envTimeout);
    timeoutByApi.set(api, t);
    return t;
  }

  const results: Array<{ record: OrphanRecord; status: number | null; ok: boolean; error?: string }> = [];
  for (const r of retriable) {
    let baseUrl = baseUrlByApi.get(r.api);
    if (!baseUrl) {
      try {
        const env = await loadEnvironment(undefined, `apis/${r.api}`);
        baseUrl = env["base_url"];
      } catch { /* fall through */ }
    }
    if (!baseUrl) {
      results.push({ record: r, status: null, ok: false, error: `base_url missing — set ZOND_BASE_URL or apis/${r.api}/.env.yaml` });
      continue;
    }
    baseUrlByApi.set(r.api, baseUrl);

    const url = `${baseUrl.replace(/\/+$/, "")}${r.deletePath}`;
    try {
      const resp = await executeRequest(
        { method: "DELETE", url, headers: {} },
        { timeout: await timeoutFor(r.api), retries: 0 },
      );
      // 404 = already gone → success. 2xx = just deleted → success.
      const ok = resp.status === 404 || (resp.status >= 200 && resp.status < 300);
      results.push({ record: r, status: resp.status, ok });
      if (ok) await markRemoved(r);
    } catch (err) {
      results.push({ record: r, status: null, ok: false, error: (err as Error).message });
    }
  }

  const removed = results.filter(r => r.ok).length;
  const failed = results.length - removed;

  if (opts.json) {
    printJson(jsonOk("cleanup", {
      retried: results.length,
      removed,
      failed,
      items: results.map(r => ({
        api: r.record.api,
        runId: r.record.runId,
        method: r.record.method,
        path: r.record.path,
        id: r.record.id,
        deletePath: r.record.deletePath,
        status: r.status,
        ok: r.ok,
        error: r.error ?? null,
      })),
      manual_cleanup_required: manualOnly.map(r => ({
        api: r.api,
        runId: r.runId,
        method: r.method,
        path: r.path,
        id: r.id,
        reason: r.lastCleanupError ?? "no DELETE counterpart",
      })),
    }));
  } else {
    if (removed > 0) printSuccess(`${removed} orphan(s) cleaned up.`);
    if (failed > 0) {
      printWarning(`${failed} orphan(s) still alive:`);
      for (const r of results) {
        if (r.ok) continue;
        const tail = r.status != null ? `→ ${r.status}` : (r.error ? `→ err: ${r.error}` : "");
        process.stderr.write(`  ${r.record.method} ${r.record.path} (id=${r.record.id}); DELETE ${r.record.deletePath} ${tail}\n`);
      }
    }
    if (manualOnly.length > 0) {
      printWarning(`${manualOnly.length} resource(s) need manual cleanup (no DELETE plan):`);
      for (const r of manualOnly) {
        process.stderr.write(`  ${r.method} ${r.path}${r.id ? ` (id=${r.id})` : ""} — ${r.lastCleanupError ?? "no DELETE counterpart"}\n`);
      }
    }
  }

  // Manual-only orphans count as "still alive" for exit-code purposes —
  // CI must fail loudly when probes leave un-deletable state behind.
  return failed > 0 || manualOnly.length > 0 ? 1 : 0;
}

export function registerCleanup(program: Command): void {
  program
    .command("cleanup")
    .description("Retry probe-leftover work. Currently only --orphans (TASK-278) — re-issues DELETE for resources captured in ~/.zond/orphans/.")
    .option("--orphans", "Retry DELETE for resources in the orphan tracker")
    .option("--api <name>", "Limit to a single API (matches the orphan-tracker subdirectory)")
    .option("--run <id>", "Limit to a single probe run id")
    .option("--dry-run", "Print the plan without sending DELETEs")
    .option("--timeout <ms>", "Per-request timeout in ms (overrides .env.yaml `timeoutMs` and zond.config.yml `defaults.timeout_ms`; default 30000)")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await cleanupCommand({
        orphans: opts.orphans === true,
        api: typeof opts.api === "string" ? opts.api : undefined,
        runId: typeof opts.run === "string" ? opts.run : undefined,
        dryRun: opts.dryRun === true,
        timeoutMs: typeof opts.timeout === "string" ? Number(opts.timeout) : undefined,
        json: globalJson(cmd),
      });
    });
}

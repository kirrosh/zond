/**
 * `zond audit --api X` — macro-команда для полного pipeline (TASK-262).
 *
 * Оборачивает 8-10 ручных шагов (prepare-fixtures → generate → probes
 * → session-wrapped run → coverage → HTML report) в одну команду:
 *
 *   1. `prepare-fixtures --apply` (или `--cascade --seed --apply` при
 *      `--seed`) — заполняет `.env.yaml` FK-идентификаторами.
 *   2. `generate` — пропускается если `apis/<name>/tests/` свежее, чем
 *      `spec.json` (mtime-эвристика; `--force` отключает skip).
 *   3. `probe static` (validation+methods, всегда). `mass-assignment` и
 *      `security` — за `--with-mass-assignment` / `--with-security`.
 *   4. `session start` → `run apis/<name>/tests` + `run apis/<name>/probes`
 *      → `session end`. Все runs наследуют один session_id.
 *   5. `coverage --api X --union session --json` для embed'a в репорт.
 *   6. Запись `audit-report.html` (или `--out`) с таблицей stages,
 *      coverage-сводкой и подсказками для drill-down.
 *
 * Каждая stage спавнится как отдельный subprocess `zond ...`. Failure
 * любой stage НЕ останавливает pipeline — финальный exit 1 если хоть одна
 * упала, 0 если все ok. `--dry-run` печатает план без выполнения.
 */

import { existsSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { globalJson } from "../resolve.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByNameOrId } from "../../db/queries.ts";
import { resolveCollectionSpec } from "../../core/setup-api.ts";
import { printSuccess, printWarning, printError } from "../output.ts";
import { getApi, MISSING_API_MESSAGE } from "../util/api-context.ts";
import { jsonOk, printJson } from "../json-envelope.ts";
import { VERSION } from "../version.ts";

interface Stage {
  key: string;
  name: string;
  args: string[];
  /** If returns string, stage is skipped with that reason. */
  skip?: () => string | null;
}

interface StageResult {
  key: string;
  name: string;
  status: "ok" | "failed" | "skipped";
  exit_code: number | null;
  duration_ms: number;
  reason?: string;
}

export interface AuditOptions {
  api: string;
  dbPath?: string;
  seed?: boolean;
  withMassAssignment?: boolean;
  withSecurity?: boolean;
  out?: string;
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
}

/**
 * Build the prefix for self-spawning `zond ...`. When the binary is
 * compiled, `process.execPath` IS the zond binary. In dev, `bun` runs the
 * script directly — fall back to `[bun, src/cli/index.ts]`.
 */
function zondInvoker(): string[] {
  const exec = process.execPath;
  const base = exec.replace(/\\/g, "/");
  if (base.endsWith("/zond") || base.endsWith("/zond.exe")) return [exec];
  const script = process.argv[1] || "src/cli/index.ts";
  return [exec, script];
}

function buildStages(opts: AuditOptions, apiDir: string, specPath: string | null): Stage[] {
  const api = opts.api;
  const stages: Stage[] = [];

  if (opts.seed) {
    stages.push({
      key: "prepare-fixtures-cascade",
      name: "prepare-fixtures (cascade discover + seed)",
      args: ["prepare-fixtures", "--api", api, "--apply", "--seed"],
    });
  } else {
    stages.push({
      key: "prepare-fixtures",
      name: "prepare-fixtures (path-FK fixtures)",
      args: ["prepare-fixtures", "--api", api, "--apply"],
    });
  }

  stages.push({
    key: "generate",
    name: "generate (smoke + crud)",
    args: ["generate", "--api", api, "--output", join(apiDir, "tests")],
    skip: () => {
      if (opts.force) return null;
      if (!specPath || !existsSync(specPath)) return null;
      const testsDir = join(apiDir, "tests");
      if (!existsSync(testsDir)) return null;
      try {
        const specMtime = statSync(specPath).mtimeMs;
        const testsMtime = statSync(testsDir).mtimeMs;
        if (testsMtime > specMtime) return "tests/ newer than spec — pass --force to regenerate";
      } catch {
        // ignore — fall through to running generate
      }
      return null;
    },
  });

  stages.push({
    key: "probe-static",
    name: "probe static (validation+methods)",
    args: ["probe", "static", "--api", api, "--output", join(apiDir, "probes", "static")],
  });

  if (opts.withMassAssignment) {
    stages.push({
      key: "probe-mass-assignment",
      name: "probe mass-assignment",
      args: [
        "probe", "mass-assignment", "--api", api,
        "--output", join(apiDir, "probes", "mass-assignment-digest.md"),
        "--emit-tests", join(apiDir, "probes", "mass-assignment"),
        "--overwrite",
      ],
    });
  }
  if (opts.withSecurity) {
    stages.push({
      key: "probe-security",
      name: "probe security (ssrf,crlf,open-redirect)",
      args: [
        "probe", "security", "ssrf,crlf,open-redirect", "--api", api,
        "--output", join(apiDir, "probes", "security-digest.md"),
        "--emit-tests", join(apiDir, "probes", "security"),
        "--overwrite",
      ],
    });
  }

  const sessionLabel = `audit-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  stages.push({ key: "session-start", name: `session start (${sessionLabel})`, args: ["session", "start", "--label", sessionLabel] });
  stages.push({ key: "run-tests", name: "run tests", args: ["run", join(apiDir, "tests"), "--api", api] });
  stages.push({ key: "run-probes", name: "run probes", args: ["run", join(apiDir, "probes"), "--api", api] });
  stages.push({ key: "session-end", name: "session end", args: ["session", "end"] });
  // ARV-108: surface the post-stage coverage capture in the plan so the
  // dry-run listing matches the actual pipeline. The stage is special-cased
  // in auditCommand — we keep stdout for JSON parsing rather than inheriting.
  stages.push({
    key: "coverage",
    name: "coverage (session union)",
    args: ["coverage", "--api", api, "--union", "session", "--json"],
  });

  return stages;
}

async function runStage(stage: Stage, idx: number, total: number, json: boolean): Promise<StageResult> {
  const skipReason = stage.skip?.();
  if (skipReason) {
    if (!json) console.log(`==> Stage ${idx}/${total}: ${stage.name} — skipped (${skipReason})`);
    return { key: stage.key, name: stage.name, status: "skipped", exit_code: null, duration_ms: 0, reason: skipReason };
  }
  if (!json) console.log(`==> Stage ${idx}/${total}: ${stage.name}`);
  const t0 = Date.now();
  const cmd = [...zondInvoker(), ...stage.args];
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  const ms = Date.now() - t0;
  return {
    key: stage.key,
    name: stage.name,
    status: code === 0 ? "ok" : "failed",
    exit_code: code,
    duration_ms: ms,
  };
}

interface CoverageCapture {
  data: unknown | null;
  exitCode: number | null;
  parseError: string | null;
  durationMs: number;
}

async function captureCoverage(api: string): Promise<CoverageCapture> {
  const t0 = Date.now();
  try {
    const cmd = [...zondInvoker(), "coverage", "--api", api, "--union", "session", "--json"];
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    const ms = Date.now() - t0;
    if (code !== 0) {
      return { data: null, exitCode: code, parseError: null, durationMs: ms };
    }
    try {
      return { data: JSON.parse(stdout), exitCode: code, parseError: null, durationMs: ms };
    } catch (e) {
      return { data: null, exitCode: code, parseError: (e as Error).message, durationMs: ms };
    }
  } catch (e) {
    return { data: null, exitCode: null, parseError: (e as Error).message, durationMs: Date.now() - t0 };
  }
}

export async function auditCommand(options: AuditOptions): Promise<number> {
  // Like bootstrap: fall back to apis/<name>/ when no DB/collection — the
  // workspace-on-disk shape is enough for the macro to drive subprocesses.
  let apiDir = `apis/${options.api}`;
  let specPath: string | null = null;
  try {
    getDb(options.dbPath);
    const col = findCollectionByNameOrId(options.api);
    if (col) {
      apiDir = col.base_dir ?? apiDir;
      specPath = col.openapi_spec ? resolveCollectionSpec(col.openapi_spec) : null;
    }
  } catch {
    // No DB — keep filesystem-only fallback.
  }
  if (!specPath) {
    const guess = join(apiDir, "spec.json");
    if (existsSync(guess)) specPath = guess;
  }

  const stages = buildStages(options, apiDir, specPath);
  const out = options.out ?? "audit-report.html";

  if (options.dryRun) {
    if (options.json) {
      printJson(jsonOk("audit", {
        plan: stages.map((s) => ({ key: s.key, name: s.name, args: s.args })),
        out,
      }));
    } else {
      console.log(`Plan: zond audit --api ${options.api} (${stages.length} stages)`);
      stages.forEach((s, i) => {
        console.log(`  ${(i + 1).toString().padStart(2)}. ${s.name}`);
        console.log(`        zond ${s.args.join(" ")}`);
      });
      console.log(`\nReport will be written to: ${out}`);
    }
    return 0;
  }

  const t0 = Date.now();
  const results: StageResult[] = [];
  let coverageJson: unknown = null;
  let coverageCapture: CoverageCapture | null = null;
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]!;
    if (stage.key === "coverage") {
      // ARV-108: coverage runs via captureCoverage so we keep stdout JSON.
      if (!options.json) console.log(`==> Stage ${i + 1}/${stages.length}: ${stage.name}`);
      coverageCapture = await captureCoverage(options.api);
      coverageJson = coverageCapture.data;
      const status: StageResult["status"] = coverageCapture.data
        ? "ok"
        : coverageCapture.exitCode === 0 && coverageCapture.parseError
          ? "failed"
          : coverageCapture.exitCode === 0
            ? "skipped"
            : "failed";
      results.push({
        key: stage.key,
        name: stage.name,
        status,
        exit_code: coverageCapture.exitCode,
        duration_ms: coverageCapture.durationMs,
        reason: status === "skipped"
          ? "no runs in session"
          : coverageCapture.parseError
            ? `non-JSON output: ${coverageCapture.parseError}`
            : status === "failed"
              ? `coverage exited ${coverageCapture.exitCode}`
              : undefined,
      });
      continue;
    }
    results.push(await runStage(stage, i + 1, stages.length, options.json === true));
  }
  const totalMs = Date.now() - t0;

  await writeAuditReport(out, {
    api: options.api,
    apiDir,
    stages: results,
    totalMs,
    coverage: coverageJson,
    coverageStage: results.find((r) => r.key === "coverage") ?? null,
    options,
  });

  // ARV-108: coverage is informational — keep it out of the fail count so we
  // don't regress the "non-fatal coverage" contract.
  const failedStages = results.filter((r) => r.status === "failed" && r.key !== "coverage");
  const failed = failedStages.length;

  if (options.json) {
    printJson(jsonOk("audit", {
      api: options.api,
      stages: results,
      total_ms: totalMs,
      failed_stages: failed,
      report: out,
      coverage: coverageJson,
    }));
  } else {
    console.log("");
    const summary = `Audit complete (${results.length} stages, ${(totalMs / 1000).toFixed(1)}s) → ${out}`;
    if (failed === 0) {
      printSuccess(summary);
    } else {
      printWarning(`${summary} — ${failed} failed: ${failedStages.map((s) => s.key).join(", ")}`);
    }
  }
  return failed === 0 ? 0 : 1;
}

interface ReportInput {
  api: string;
  apiDir: string;
  stages: StageResult[];
  totalMs: number;
  coverage: unknown;
  /** ARV-108: outcome of the post-stage coverage capture, so the HTML can
   *  distinguish "no session runs" from "coverage subcommand failed". */
  coverageStage: StageResult | null;
  options: AuditOptions;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[c]!;
  });
}

interface CoverageEnvelope {
  data?: {
    totals?: { all?: number; covered2xx?: number; coveredButNon2xx?: number; unhit?: number };
    pass_coverage?: { ratio?: number };
    hit_coverage?: { ratio?: number };
    coveredButNon2xxEndpoints?: Array<{ endpoint?: string }>;
    unhitEndpoints?: Array<{ endpoint?: string }>;
  };
}

async function writeAuditReport(outPath: string, data: ReportInput): Promise<void> {
  const cov = data.coverage as CoverageEnvelope | null;
  const totals = cov?.data?.totals;
  const pass = cov?.data?.pass_coverage?.ratio;
  const hit = cov?.data?.hit_coverage?.ratio;

  const stageRows = data.stages.map((s) => {
    const cls = s.status === "ok" ? "ok" : s.status === "failed" ? "fail" : "skip";
    const ms = s.duration_ms === 0 ? "—" : `${(s.duration_ms / 1000).toFixed(1)}s`;
    return `<tr class="${cls}"><td>${escapeHtml(s.name)}</td><td>${s.status}</td><td>${s.exit_code ?? "—"}</td><td>${ms}</td><td>${escapeHtml(s.reason ?? "")}</td></tr>`;
  }).join("\n");

  const reruncmd = `zond audit --api ${data.api}`
    + (data.options.seed ? " --seed" : "")
    + (data.options.withMassAssignment ? " --with-mass-assignment" : "")
    + (data.options.withSecurity ? " --with-security" : "");

  const covStage = data.coverageStage;
  // ARV-108: tailor the warning to what actually happened so the HTML stops
  // misreporting "stage failed" when the stage was skipped (no runs in the
  // session) or simply produced unparseable output.
  const coverageWarning = covStage
    ? covStage.status === "skipped"
      ? "No session runs to summarise. Add `--with-mass-assignment` / `--with-security`, or run tests/probes that succeed."
      : covStage.reason
        ? `Coverage stage ${covStage.status}: ${escapeHtml(covStage.reason)}.`
        : `Coverage stage ${covStage.status} (exit ${covStage.exit_code ?? "?"}).`
    : "Coverage stage was not part of this audit (older binary?).";

  const coverageBlock = totals
    ? `<h2>Coverage (session union)</h2>
<div class="cov">
  <div><div class="num">${totals.covered2xx ?? 0}/${totals.all ?? 0}</div><div class="lbl">covered2xx</div></div>
  <div><div class="num">${totals.coveredButNon2xx ?? 0}</div><div class="lbl">covered but non-2xx</div></div>
  <div><div class="num">${totals.unhit ?? 0}</div><div class="lbl">unhit</div></div>
  ${typeof pass === "number" ? `<div><div class="num">${(pass * 100).toFixed(0)}%</div><div class="lbl">pass coverage</div></div>` : ""}
  ${typeof hit === "number" ? `<div><div class="num">${(hit * 100).toFixed(0)}%</div><div class="lbl">hit coverage</div></div>` : ""}
</div>`
    : `<h2>Coverage</h2><div class="warn">${coverageWarning}</div>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>zond audit — ${escapeHtml(data.api)}</title>
<style>
body { font: 14px -apple-system, system-ui, sans-serif; max-width: 960px; margin: 2em auto; padding: 0 1em; color: #222; }
h1 { font-size: 1.4em; margin-bottom: 0.2em; }
h2 { font-size: 1.05em; margin-top: 2em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
.meta { color: #666; font-size: 0.9em; margin-bottom: 1em; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.92em; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eee; }
th { background: #f7f7f7; }
tr.ok td:nth-child(2) { color: #0a7; }
tr.fail td:nth-child(2) { color: #c33; font-weight: 600; }
tr.skip td:nth-child(2) { color: #888; font-style: italic; }
.cov { display: flex; gap: 2em; margin: 1em 0; flex-wrap: wrap; }
.cov .num { font-size: 1.6em; font-weight: 600; }
.cov .lbl { font-size: 0.8em; color: #666; }
.warn { background: #fef9e7; padding: 8px 12px; border-left: 3px solid #f0c040; margin: 1em 0; }
code { background: #f4f4f4; padding: 1px 5px; border-radius: 3px; font-size: 0.9em; }
ul { line-height: 1.6; }
</style></head>
<body>
<h1>zond audit — ${escapeHtml(data.api)}</h1>
<div class="meta">
  zond ${escapeHtml(VERSION)} · ${new Date().toISOString()} · total ${(data.totalMs / 1000).toFixed(1)}s · apiDir <code>${escapeHtml(data.apiDir)}</code>
</div>

<h2>Stages</h2>
<table><thead><tr><th>Stage</th><th>Status</th><th>Exit</th><th>Duration</th><th>Note</th></tr></thead><tbody>
${stageRows}
</tbody></table>

${coverageBlock}

<h2>Drill-down</h2>
<ul>
  <li>Per-run HTML: <code>zond report export &lt;run-id&gt;</code></li>
  <li>Diagnose failures: <code>zond db diagnose &lt;run-id&gt; --json</code></li>
  <li>Re-run audit: <code>${escapeHtml(reruncmd)}</code></li>
</ul>
</body></html>`;

  await writeFile(outPath, html, "utf-8");
}

export function registerAudit(program: Command): void {
  program
    .command("audit")
    .description("Macro: prepare-fixtures → generate → probes → run → coverage → HTML report (TASK-262)")
    // ARV-29: not `requiredOption` — same regression that hit prepare-fixtures
    // (TASK-20) and checks run (TASK-17). Commander routes `--api` to the
    // program-level option, so the subcommand's opts.api ends up undefined and
    // requiredOption rejects every form (`--api foo`, `--api=foo`, even
    // `zond --api foo audit`). Fall back the same way: explicit > program-level
    // mirror > .zond/current-api.
    .option("--api <name>", "Registered API to audit. Falls back to ZOND_API / .zond/current-api.")
    .option("--db <path>", "Path to SQLite database file")
    .option("--seed", "Use 'prepare-fixtures --cascade --seed --apply' instead of the plain single-pass prep stage")
    .option("--with-mass-assignment", "Include 'probe mass-assignment' as an extra stage")
    .option("--with-security", "Include 'probe security ssrf,crlf,open-redirect' as an extra stage")
    .option("--out <path>", "HTML report output path (default: audit-report.html)")
    .option("--dry-run", "Print the stage plan without executing anything")
    .option("--force", "Disable mtime-based skip (always regenerate, even if tests/ newer than spec)")
    .action(async (opts, cmd: Command) => {
      // ARV-53.
      const apiName = getApi(cmd, opts);
      if (!apiName) {
        printError(MISSING_API_MESSAGE);
        process.exitCode = 2;
        return;
      }
      opts.api = apiName;
      process.exitCode = await auditCommand({
        api: opts.api,
        dbPath: opts.db,
        seed: opts.seed === true,
        withMassAssignment: opts.withMassAssignment === true,
        withSecurity: opts.withSecurity === true,
        out: opts.out,
        dryRun: opts.dryRun === true,
        force: opts.force === true,
        json: globalJson(cmd),
      });
    });
}

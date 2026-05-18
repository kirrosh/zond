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
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { globalJson } from "../resolve.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByNameOrId, listSessions, listRunsBySession } from "../../db/queries.ts";
import { resolveCollectionSpec } from "../../core/setup-api.ts";
import { printSuccess, printWarning, printError } from "../output.ts";
import { getApi, MISSING_API_MESSAGE } from "../util/api-context.ts";
import { jsonOk, printJson } from "../json-envelope.ts";
import { VERSION } from "../version.ts";
import { diagnoseRun, type DiagnoseResult } from "../../core/diagnostics/db-analysis.ts";
import { readCurrentSession } from "../../core/context/session.ts";
import { resolveBudget, isBudget, BUDGETS, type Budget } from "../../core/checks/budget.ts";

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
  /** ARV-264: opt-in to the full pipeline against a real-traffic API.
   *  When false (default), audit runs in safe mode — no --seed POSTs,
   *  no mass-assignment / security probes, no destructive probes. */
  live?: boolean;
  /** ARV-292: adaptive cap and stateful gating tier. Translates to
   *  `--max-requests N` on every spawned `run` stage. */
  budget?: Budget;
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
  const budgetResolved = resolveBudget(opts.budget, undefined);
  const runMaxRequestsArgs: string[] = budgetResolved.maxRequests !== undefined
    ? ["--max-requests", String(budgetResolved.maxRequests)]
    // placeholder to keep the binding shape stable
    : [];
  // ARV-302: probes don't share `zond run`'s --max-requests vocabulary
  // (probes scan endpoint-by-endpoint, not request-by-request). Map the
  // budget tier to a coarse `--max-endpoints` cap so probe stages stay
  // inside the same wall-clock budget. `full` keeps the legacy
  // uncapped behaviour.
  const probeMaxEndpointsByTier: Record<string, number | undefined> = {
    quick: 10,
    standard: 50,
    full: undefined,
  };
  const probeMaxEndpoints = opts.budget ? probeMaxEndpointsByTier[opts.budget] : undefined;
  const probeMaxEndpointsArgs: string[] = probeMaxEndpoints !== undefined
    ? ["--max-endpoints", String(probeMaxEndpoints)]
    : [];

  // ARV-264: in safe mode (default) `--seed` is ignored — seed POSTs
  // create real resources on the target API and have unacceptable blast
  // radius when the user hasn't opted into --live. The "stage skipped:
  // seed requires --live" warning is printed by `runSafeModeGuard`
  // before the pipeline starts.
  const seedEnabled = opts.seed === true && opts.live === true;
  if (seedEnabled) {
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

  // ARV-264: mass-assignment + security probes send real POST/PUT/DELETE
  // traffic. Gate them behind --live so the default (safe) audit can't
  // pollute a production API.
  const liveProbesEnabled = opts.live === true;
  if (opts.withMassAssignment && liveProbesEnabled) {
    stages.push({
      key: "probe-mass-assignment",
      name: "probe mass-assignment",
      args: [
        "probe", "mass-assignment", "--api", api,
        "--output", join(apiDir, "probes", "mass-assignment-digest.md"),
        "--emit-tests", join(apiDir, "probes", "mass-assignment"),
        "--overwrite",
        ...probeMaxEndpointsArgs,
      ],
    });
  }
  if (opts.withSecurity && liveProbesEnabled) {
    stages.push({
      key: "probe-security",
      name: "probe security (ssrf,crlf,open-redirect)",
      args: [
        "probe", "security", "ssrf,crlf,open-redirect", "--api", api,
        "--output", join(apiDir, "probes", "security-digest.md"),
        "--emit-tests", join(apiDir, "probes", "security"),
        "--overwrite",
        ...probeMaxEndpointsArgs,
      ],
    });
  }

  // ARV-65: if the user already has an active session, REUSE it — don't
  // clobber their .zond/current-session by spawning audit's own. Skipping
  // session-end is the critical half: otherwise audit clears the user's
  // session even when start was a no-op.
  const existingSession = readCurrentSession();
  const sessionLabel = `audit-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  if (existingSession) {
    const reuseReason = `reusing active session ${existingSession.id}${existingSession.label ? ` (${existingSession.label})` : ""}`;
    stages.push({
      key: "session-start",
      name: "session start (reused)",
      args: ["session", "start", "--label", sessionLabel],
      skip: () => reuseReason,
    });
    stages.push({ key: "run-tests", name: "run tests", args: ["run", join(apiDir, "tests"), "--api", api, ...runMaxRequestsArgs] });
    stages.push({ key: "run-probes", name: "run probes", args: ["run", join(apiDir, "probes"), "--api", api, ...runMaxRequestsArgs] });
    stages.push({
      key: "session-end",
      name: "session end (reused — kept active)",
      args: ["session", "end"],
      skip: () => reuseReason,
    });
  } else {
    stages.push({ key: "session-start", name: `session start (${sessionLabel})`, args: ["session", "start", "--label", sessionLabel] });
    stages.push({ key: "run-tests", name: "run tests", args: ["run", join(apiDir, "tests"), "--api", api, ...runMaxRequestsArgs] });
    stages.push({ key: "run-probes", name: "run probes", args: ["run", join(apiDir, "probes"), "--api", api, ...runMaxRequestsArgs] });
    stages.push({ key: "session-end", name: "session end", args: ["session", "end"] });
  }
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
  const status: StageResult["status"] = code === 0 ? "ok" : "failed";
  // ARV-66: print a per-stage completion line so the user sees OK/FAIL inline
  // next to "Stage N/M" instead of inferring from the final summary. Subprocess
  // stdio is inherited above, so this line lands AFTER the stage's own output.
  if (!json) {
    const tag = status === "ok" ? "OK" : `FAIL (exit ${code})`;
    console.log(`    └─ ${tag} · ${(ms / 1000).toFixed(1)}s`);
  }
  return { key: stage.key, name: stage.name, status, exit_code: code, duration_ms: ms };
}

interface CoverageCapture {
  data: unknown | null;
  exitCode: number | null;
  parseError: string | null;
  durationMs: number;
}

/**
 * ARV-301: build the coverage-stage CLI args. Exported so unit tests
 * can assert that audit pins `--session-id <id>` rather than
 * `--union session` whenever a session id was captured ahead of
 * `session end` (the latter selector rejects closed sessions).
 */
export function buildCoverageStageArgs(api: string, sessionId?: string): string[] {
  const sel = sessionId ? ["--session-id", sessionId] : ["--union", "session"];
  return ["coverage", "--api", api, ...sel, "--json"];
}

async function captureCoverage(api: string, sessionId?: string): Promise<CoverageCapture> {
  const t0 = Date.now();
  try {
    const cmd = [...zondInvoker(), ...buildCoverageStageArgs(api, sessionId)];
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

  // ARV-264: surface what safe mode silently drops and run pre-flight
  // checks (auth + security schemes) before any subprocess fires.
  const preflightWarnings = runSafePreflight(options, specPath, apiDir);
  if (!options.json) {
    for (const w of preflightWarnings) printWarning(w);
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
  // ARV-301: capture the active session id BEFORE session-end runs, so
  // coverage can target it explicitly (--session-id) instead of via
  // --union session, which would reject the now-closed session.
  let pinnedSessionId: string | undefined;
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]!;
    if (stage.key === "session-end" && !pinnedSessionId) {
      pinnedSessionId = readCurrentSession()?.id;
    }
    if (stage.key === "coverage") {
      // ARV-108: coverage runs via captureCoverage so we keep stdout JSON.
      if (!options.json) console.log(`==> Stage ${i + 1}/${stages.length}: ${stage.name}`);
      coverageCapture = await captureCoverage(options.api, pinnedSessionId);
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
      // ARV-66: per-stage completion line for the coverage special-case too.
      if (!options.json) {
        const tag = status === "ok" ? "OK" : status === "skipped" ? "SKIPPED" : `FAIL (exit ${coverageCapture.exitCode})`;
        console.log(`    └─ ${tag} · ${(coverageCapture.durationMs / 1000).toFixed(1)}s`);
      }
      continue;
    }
    results.push(await runStage(stage, i + 1, stages.length, options.json === true));
  }
  const totalMs = Date.now() - t0;

  // ARV-158: collect per-run drill-down from the audit session so the HTML
  // can answer "WHICH 271 findings" instead of just "3 failed stages".
  // The session was started by `session-start` and closed by `session-end`,
  // so it's the most recent session in the DB at this point. listSessions(1)
  // surfaces it; we then diagnose each run with failures > 0 (passed-only
  // runs need no triage).
  const drilldown: Array<{ run: { id: number; failed: number; total: number; passed: number }; diagnose: DiagnoseResult }> = [];
  try {
    const recent = listSessions(1);
    const session = recent[0];
    if (session?.session_id) {
      const runs = listRunsBySession(session.session_id);
      for (const r of runs) {
        if (r.failed <= 0) continue;
        try {
          const diag = diagnoseRun(r.id, false, options.dbPath);
          drilldown.push({
            run: { id: r.id, failed: r.failed, total: r.total, passed: r.passed },
            diagnose: diag,
          });
        } catch {
          // diagnose of a single run failing should not break the report —
          // skip and keep the rest.
        }
      }
    }
  } catch {
    // DB unreachable / no sessions — leave drilldown empty; HTML degrades
    // to the previous summary-only form.
  }

  await writeAuditReport(out, {
    api: options.api,
    apiDir,
    stages: results,
    totalMs,
    coverage: coverageJson,
    coverageStage: results.find((r) => r.key === "coverage") ?? null,
    options,
    drilldown,
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
    // ARV-80: print absolute path so the user can open the HTML report
    // without traversing — `audit-report.html` (relative) hid the location
    // behind cwd, especially when audit was invoked from a parent dir.
    const summary = `Audit complete (${results.length} stages, ${(totalMs / 1000).toFixed(1)}s) → ${resolve(out)}`;
    if (failed === 0) {
      printSuccess(summary);
    } else {
      printWarning(`${summary} — ${failed} failed: ${failedStages.map((s) => s.key).join(", ")}`);
    }
  }
  return failed === 0 ? 0 : 1;
}

export interface ReportInput {
  api: string;
  apiDir: string;
  stages: StageResult[];
  totalMs: number;
  coverage: unknown;
  /** ARV-108: outcome of the post-stage coverage capture, so the HTML can
   *  distinguish "no session runs" from "coverage subcommand failed". */
  coverageStage: StageResult | null;
  options: AuditOptions;
  /** ARV-158: per-run diagnose envelopes for runs in this audit's session
   *  that had failures. Each entry feeds a collapsible drill-down block
   *  in the HTML so the report answers "WHICH findings" inline. Empty
   *  array when no runs failed or when DB lookup couldn't reach the
   *  session. */
  drilldown: Array<{
    run: { id: number; failed: number; total: number; passed: number };
    diagnose: DiagnoseResult;
  }>;
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

/** ARV-158: exported for regression-test on HTML markup (drill-down
 *  sections per failed run). Same signature as before — the export
 *  doesn't expose anything CLI-internal. */
export async function writeAuditReport(outPath: string, data: ReportInput): Promise<void> {
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

  // ARV-158: per-run drill-down — collapsible sections, one per failed
  // run, surfacing by_recommended_action buckets (count + first example).
  // Concrete commands replace the previous "type <run-id> manually" hint.
  const drilldownBlocks = data.drilldown.length === 0
    ? ""
    : `<h2>Failures by run</h2>\n` + data.drilldown.map(({ run, diagnose }) => {
        const buckets = diagnose.by_recommended_action ?? {};
        // Sort buckets by priority (report_backend_bug first, then by count)
        // — matches the zond-triage skill priority order.
        const priorityOrder = [
          "report_backend_bug",
          "fix_spec",
          "fix_auth_config",
          "fix_env",
          "fix_fixture",
          "fix_network_config",
          "regenerate_suite",
          "tighten_validation",
          "add_required_header",
          "fix_test_logic",
          "wontfix_known_limitation",
        ];
        const sortedKeys = Object.keys(buckets).sort((a, b) => {
          const ai = priorityOrder.indexOf(a);
          const bi = priorityOrder.indexOf(b);
          if (ai === -1 && bi === -1) return (buckets[b]!.count) - (buckets[a]!.count);
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
        const bucketsHtml = sortedKeys.length === 0
          ? `<p class="muted">No <code>recommended_action</code> buckets — see raw failures via the commands below.</p>`
          : `<ul class="buckets">` + sortedKeys.map((key) => {
              const b = buckets[key]!;
              const first = b.examples[0];
              const sample = first
                ? `<code>${escapeHtml(first.method)} ${escapeHtml(first.path)}</code> → <strong>${first.status}</strong>${first.reason ? ` — ${escapeHtml(first.reason)}` : ""}`
                : "";
              const moreExamples = b.examples.length > 1
                ? ` <span class="muted">(+${b.examples.length - 1} more)</span>`
                : "";
              return `<li><strong>${escapeHtml(key)}</strong> ×${b.count}${sample ? ` — ${sample}${moreExamples}` : ""}</li>`;
            }).join("\n") + `</ul>`;
        const envIssueHtml = diagnose.env_issue
          ? `<div class="warn">env_issue (${escapeHtml(diagnose.env_issue.scope)}): ${escapeHtml(diagnose.env_issue.message)}</div>`
          : "";
        return `<details>
  <summary>Run #${run.id} — ${run.failed}/${run.total} failed (${run.passed} passed)</summary>
  ${envIssueHtml}
  ${bucketsHtml}
  <p class="cmds">
    Drill in: <code>zond db diagnose --run-id ${run.id} --json</code> ·
    <code>zond report export ${run.id}</code>
  </p>
</details>`;
      }).join("\n");

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
details { margin: 0.8em 0; border: 1px solid #eee; border-radius: 4px; padding: 0.3em 0.8em; }
details summary { cursor: pointer; font-weight: 600; padding: 0.3em 0; }
details[open] summary { border-bottom: 1px solid #eee; margin-bottom: 0.6em; }
ul.buckets { padding-left: 1.2em; margin: 0.4em 0; }
ul.buckets li { margin: 0.25em 0; }
p.cmds { font-size: 0.88em; color: #555; margin-top: 0.8em; }
.muted { color: #888; }
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

${drilldownBlocks}

<h2>Drill-down</h2>
<ul>
  <li>Re-run audit: <code>${escapeHtml(reruncmd)}</code></li>
  <li>List recent runs: <code>zond db runs --limit 20</code></li>
  <li>Per-run report: <code>zond report export &lt;run-id&gt;</code></li>
</ul>
</body></html>`;

  await writeFile(outPath, html, "utf-8");
}

/**
 * ARV-264: pre-flight checks for safe-mode auditing.
 *
 *  1. Warn when the user passed `--seed` / `--with-mass-assignment` /
 *     `--with-security` without `--live` — those stages are silently
 *     dropped in safe mode and the user deserves to know.
 *  2. Warn when the spec declares `components.securitySchemes` but the
 *     workspace has no `auth_token` set — every probe will skip with
 *     401 and the report will read as "all green" misleadingly.
 *  3. Warn when no security schemes are declared at all (open API or
 *     incomplete spec) — same misleading-green risk on auth gates.
 */
export function runSafePreflight(
  opts: AuditOptions,
  specPath: string | null,
  apiDir: string,
): string[] {
  const out: string[] = [];
  const safe = opts.live !== true;

  if (safe) {
    if (opts.seed) {
      out.push(
        "audit --safe (default): --seed ignored. Seed POSTs create real resources on the target API. " +
        "Re-run with --live to enable, only against a throwaway / sandbox account.",
      );
    }
    if (opts.withMassAssignment) {
      out.push(
        "audit --safe (default): --with-mass-assignment ignored. Mass-assignment probes POST mutated " +
        "bodies and follow up with GET/DELETE — high blast radius. Re-run with --live to enable.",
      );
    }
    if (opts.withSecurity) {
      out.push(
        "audit --safe (default): --with-security ignored. Security probes send live SSRF/CRLF/redirect " +
        "payloads to real endpoints. Re-run with --live to enable.",
      );
    }
  }

  // Spec-level checks (cheap synchronous read; spec.json is JSON).
  if (specPath && existsSync(specPath)) {
    try {
      const spec = JSON.parse(require("node:fs").readFileSync(specPath, "utf-8")) as {
        components?: { securitySchemes?: Record<string, unknown> };
      };
      const hasSchemes = Boolean(
        spec.components?.securitySchemes && Object.keys(spec.components.securitySchemes).length > 0,
      );
      const envPath = join(apiDir, ".env.yaml");
      let authTokenSet = false;
      if (existsSync(envPath)) {
        const env = require("node:fs").readFileSync(envPath, "utf-8") as string;
        // Match `auth_token: ...` lines whose value isn't an unfilled placeholder.
        authTokenSet = /^\s*auth_token\s*:\s*(?!["']?\s*(<|UNSET|TODO|REPLACE|null|~)\b)\S/m.test(env);
      }
      if (hasSchemes && !authTokenSet) {
        out.push(
          "spec declares securitySchemes but auth_token is unset in .env.yaml — probes will likely hit " +
          "401/403 and the report can read misleadingly green. Run `zond doctor --api " + opts.api + "` to fix.",
        );
      } else if (!hasSchemes) {
        out.push(
          "spec declares no securitySchemes — either the API is open or the spec is incomplete. " +
          "Auth-related checks (ignored_auth, open_cors_on_sensitive) will skip; verify before sharing the report.",
        );
      }
    } catch {
      // Spec unreadable — separate failure mode, surfaced by other stages.
    }
  }

  return out;
}

export function registerAudit(program: Command): void {
  program
    .command("audit")
    .description("Smoke + breadth-coverage macro: prepare-fixtures → generate → probe static → session-wrapped run → coverage → HTML report. For depth-checks / security probes / stateful invariants, drive the `zond` skill — `audit` is the breadth pass, depth is the skill's job.")
    // ARV-29: not `requiredOption` — same regression that hit prepare-fixtures
    // (TASK-20) and checks run (TASK-17). Commander routes `--api` to the
    // program-level option, so the subcommand's opts.api ends up undefined and
    // requiredOption rejects every form (`--api foo`, `--api=foo`, even
    // `zond --api foo audit`). Fall back the same way: explicit > program-level
    // mirror > .zond/current-api.
    .option("--api <name>", "Registered API to audit. Falls back to ZOND_API / .zond/current-api.")
    .option("--db <path>", "Path to SQLite database file")
    .option("--seed", "Use 'prepare-fixtures --cascade --seed --apply' instead of the plain single-pass prep stage. Requires --live.")
    .option("--with-mass-assignment", "Include 'probe mass-assignment' as an extra stage. Requires --live.")
    .option("--with-security", "Include 'probe security ssrf,crlf,open-redirect' as an extra stage. Requires --live.")
    .option("--live", "ARV-264: opt into the full pipeline against a real-traffic API. Without this flag, audit runs in safe mode: no seed POSTs, no mass-assignment / security probes, no destructive traffic. Use only against throwaway/sandbox accounts.")
    .option("--out <path>", "HTML report output path (default: audit-report.html)")
    .option("--dry-run", "Print the stage plan without executing anything")
    .option("--force", "Disable mtime-based skip (always regenerate, even if tests/ newer than spec)")
    .option(
      "--budget <tier>",
      "ARV-292: adaptive request cap for spawned `run` stages. `quick` (50 req, ~60-sec gate), `standard` (500 req), `full` (uncapped). Omitted ⇒ legacy uncapped pipeline.",
    )
    .action(async (opts, cmd: Command) => {
      // ARV-53.
      const apiName = getApi(cmd, opts);
      if (!apiName) {
        printError(MISSING_API_MESSAGE);
        process.exitCode = 2;
        return;
      }
      opts.api = apiName;
      let budget: Budget | undefined;
      if (opts.budget !== undefined) {
        if (!isBudget(opts.budget)) {
          printError(`--budget must be one of: ${BUDGETS.join(", ")}; got '${opts.budget}'`);
          process.exitCode = 2;
          return;
        }
        budget = opts.budget;
      }
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
        live: opts.live === true,
        budget,
      });
    });
}

/**
 * `zond checks` umbrella — schemathesis-style depth checks framework
 * (m-15 ARV-1). Two subcommands today:
 *
 *   zond checks list             — emit the registered check catalog so
 *                                  agents can discover what's available.
 *   zond checks run              — execute the active checks against a
 *                                  live API and emit findings.
 *
 * Built-in checks register themselves on import via `core/checks` —
 * adding a new check (ARV-2/3/4) doesn't require touching this file.
 */
import { writeFileSync, readFileSync, openSync, writeSync, closeSync } from "node:fs";
import { resolve as resolvePath, relative as relativePath } from "node:path";
import type { Command } from "commander";

import { listChecks, runChecks } from "../../core/checks/index.ts";
import { listStatefulChecks } from "../../core/checks/stateful.ts";
import { generateSarifReport } from "../../core/checks/sarif.ts";
import { emitToStdout } from "../../core/reporter/ndjson.ts";
import { parseWorkers } from "../../core/runner/async-pool.ts";
import { createAdaptiveRateLimiter, createRateLimiter, type RateLimiter } from "../../core/runner/rate-limiter.ts";
import { compileOperationFilter } from "../../core/selectors/operation-filter.ts";
import { resolveSpecArg, globalJson, resolveApiCollection } from "../resolve.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { printError, printSuccess } from "../output.ts";
import { loadEnvironment } from "../../core/parser/variables.ts";
import { getApi } from "../util/api-context.ts";
import { VERSION } from "../version.ts";

interface ChecksListOptions {
  json?: boolean;
}

async function checksListAction(_args: unknown, cmd: Command): Promise<void> {
  const opts = cmd.opts<ChecksListOptions>();
  const json = opts.json === true || globalJson(cmd);
  const catalog = [
    ...listChecks().map((c) => ({
      id: c.id,
      severity: c.severity,
      default_expected: c.defaultExpected,
      references: c.references,
      phase: "response" as const,
    })),
    ...listStatefulChecks().map((c) => ({
      id: c.id,
      severity: c.severity,
      default_expected: c.defaultExpected,
      references: c.references,
      phase: c.phase,
    })),
  ].sort((a, b) => a.id.localeCompare(b.id));

  if (json) {
    printJson(jsonOk("checks list", { checks: catalog }));
  } else {
    printSuccess(`${catalog.length} check(s) registered`);
    for (const c of catalog) {
      console.log(`  ${c.id}  [${c.severity}]  — ${c.default_expected}`);
    }
  }
  process.exit(0);
}

interface ChecksRunOptions {
  api?: string;
  spec?: string;
  baseUrl?: string;
  check?: string[];
  excludeCheck?: string[];
  timeout?: number;
  db?: string;
  json?: boolean;
  authHeader?: string[];
  bootstrapCleanupFailed?: boolean;
  report?: string;
  output?: string;
  phase?: string;
  allowX00?: boolean;
  mode?: string;
  include?: string[];
  exclude?: string[];
  ndjson?: boolean;
  workers?: string;
  rateLimit?: string;
  verbose?: boolean;
}

function parseAuthHeaders(values: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of values ?? []) {
    const idx = raw.indexOf(":");
    if (idx <= 0) continue;
    const name = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

async function deriveAuthHeadersFromApi(apiName: string | undefined, dbPath: string | undefined): Promise<Record<string, string>> {
  if (!apiName) return {};
  const col = resolveApiCollection(apiName, dbPath);
  if ("error" in col || !col.baseDir) return {};
  try {
    const env = await loadEnvironment(undefined, col.baseDir);
    const out: Record<string, string> = {};
    if (typeof env.auth_token === "string" && env.auth_token.length > 0) {
      out["Authorization"] = `Bearer ${env.auth_token}`;
    }
    if (typeof env.api_key === "string" && env.api_key.length > 0) {
      out["X-API-Key"] = env.api_key;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * ARV-26: render the per-(check, reason) skip tally as a single line so
 * "0 findings" doesn't read as "all green" when half the probes never got
 * a checkable response (e.g. no auth → 4xx → no schema on that branch).
 *
 * Top-3 reasons are inlined; if more exist, append "; +N more". Returns
 * empty string when nothing was skipped.
 */
function formatSkippedOutcomes(skipped: Record<string, number> | undefined): string {
  if (!skipped) return "";
  const entries = Object.entries(skipped).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "";
  const total = entries.reduce((acc, [, n]) => acc + n, 0);
  const top = entries.slice(0, 3).map(([k, n]) => `${k} ×${n}`);
  const tail = entries.length > 3 ? `; +${entries.length - 3} more` : "";
  return `(${total} check outcome(s) skipped: ${top.join("; ")}${tail})`;
}

function splitList(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  return values.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean);
}

async function resolveBaseUrl(
  apiName: string | undefined,
  baseUrlFlag: string | undefined,
  dbPath: string | undefined,
): Promise<{ baseUrl: string } | { error: string }> {
  if (typeof baseUrlFlag === "string" && baseUrlFlag.length > 0) {
    return { baseUrl: baseUrlFlag };
  }
  // ARV-53: caller already resolved --api through cli/util/api-context.ts;
  // we only widen here when nothing reached us (allows --base-url to be the
  // sole input). Keep readCurrentApi() inline-free.
  const effectiveApi = apiName;
  if (!effectiveApi) {
    return { error: "Need --base-url <url> (or --api <name> with base_url in apis/<name>/.env.yaml)" };
  }
  const col = resolveApiCollection(effectiveApi, dbPath);
  if ("error" in col) return col;
  if (!col.baseDir) {
    return { error: `API '${effectiveApi}' has no base_dir registered — pass --base-url <url>` };
  }
  const env = await loadEnvironment(undefined, col.baseDir);
  const v = env.base_url;
  if (typeof v !== "string" || v.length === 0) {
    return { error: `base_url not set in ${col.baseDir}/.env.yaml — pass --base-url <url>` };
  }
  return { baseUrl: v };
}

async function checksRunAction(_args: unknown, cmd: Command): Promise<void> {
  const opts = cmd.opts<ChecksRunOptions>();
  const json = opts.json === true || globalJson(cmd);

  // ARV-63 (F2): `--report ndjson` is a friendly alias for `--ndjson`.
  // The skill prompt and earlier docs referred to it that way; rather than
  // surface a confusing "Available: sarif" error, fold the alias into the
  // dedicated streaming flag and treat downstream code as if --ndjson was
  // passed. Anything other than "ndjson" / "sarif" still hits the unknown-
  // format branch below.
  let reportFormatFromAlias = false;
  if (opts.report === "ndjson") {
    opts.ndjson = true;
    opts.report = undefined;
    reportFormatFromAlias = true;
  }
  const ndjson = opts.ndjson === true;

  // ARV-10: --ndjson and --json render fundamentally different shapes
  // (stream of events vs. one envelope). Mixing them silently would
  // produce malformed output — fail loudly with the same exit code as
  // other CLI-input errors.
  if (ndjson && json) {
    const msg = "--ndjson and --json are mutually exclusive — pick one";
    printError(msg);
    process.exit(2);
  }
  if (ndjson && typeof opts.report === "string" && !reportFormatFromAlias) {
    const msg = "--ndjson conflicts with --report — pick one output channel";
    printError(msg);
    process.exit(2);
  }

  // ARV-53: one resolver for --api across all of `checks run`'s sub-lookups
  // (spec, base_url, auth-header derivation).
  const apiName = getApi(cmd, opts as unknown as Record<string, unknown>);
  const specRes = resolveSpecArg(opts.spec, apiName, opts.db);
  if ("error" in specRes) {
    if (json) printJson(jsonError("checks run", [specRes.error]));
    else printError(specRes.error);
    process.exit(2);
  }

  const baseRes = await resolveBaseUrl(apiName, opts.baseUrl, opts.db);
  if ("error" in baseRes) {
    if (json) printJson(jsonError("checks run", [baseRes.error]));
    else printError(baseRes.error);
    process.exit(2);
  }

  // ARV-3: lift auth headers from --auth-header (wins) and/or the
  // resolved --api's .env.yaml (auth_token / api_key conventions).
  const fromEnv = await deriveAuthHeadersFromApi(apiName, opts.db);
  const fromFlags = parseAuthHeaders(opts.authHeader);
  const authHeaders = { ...fromEnv, ...fromFlags };

  const phaseRaw = typeof opts.phase === "string" ? opts.phase : "examples";
  if (phaseRaw !== "examples" && phaseRaw !== "coverage" && phaseRaw !== "all") {
    const msg = `Unknown --phase: "${phaseRaw}". Available: examples, coverage, all`;
    if (json) printJson(jsonError("checks run", [msg]));
    else printError(msg);
    process.exit(2);
  }

  const modeRaw = typeof opts.mode === "string" ? opts.mode : "all";
  if (modeRaw !== "positive" && modeRaw !== "negative" && modeRaw !== "all") {
    const msg = `Unknown --mode: "${modeRaw}". Available: positive, negative, all`;
    if (json) printJson(jsonError("checks run", [msg]));
    else printError(msg);
    process.exit(2);
  }

  // ARV-9: parse the unified --include/--exclude filter specs. Bad
  // specs surface as a friendly multi-line error (not a stack trace) and
  // exit 2 — the same code as other CLI-input failures here.
  const compiled = compileOperationFilter({ includes: opts.include, excludes: opts.exclude });
  if (compiled.errors.length > 0) {
    if (json) printJson(jsonError("checks run", compiled.errors));
    else for (const e of compiled.errors) printError(e);
    process.exit(2);
  }
  const operationFilter = (opts.include?.length || opts.exclude?.length) ? compiled.filter : undefined;

  // ARV-8: --workers <n|auto>. Errors here are CLI-input failures (exit
  // 2) — we don't want a stack trace for a typo.
  let workers: number;
  try {
    workers = parseWorkers(opts.workers);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (json) printJson(jsonError("checks run", [msg]));
    else printError(msg);
    process.exit(2);
  }

  // ARV-8: --rate-limit <rps|auto>. `auto` = adaptive (reacts to
  // RateLimit-* response headers); numeric = fixed RPS budget.
  let rateLimiter: RateLimiter | undefined;
  if (typeof opts.rateLimit === "string" && opts.rateLimit.length > 0) {
    const v = opts.rateLimit.trim().toLowerCase();
    if (v === "auto") {
      rateLimiter = createAdaptiveRateLimiter();
    } else {
      const rps = Number.parseFloat(v);
      if (!Number.isFinite(rps) || rps <= 0) {
        const msg = `Invalid --rate-limit value: "${opts.rateLimit}" (expected positive number or "auto")`;
        if (json) printJson(jsonError("checks run", [msg]));
        else printError(msg);
        process.exit(2);
      }
      rateLimiter = createRateLimiter(rps);
    }
  }

  // ARV-97 (F2): `--report ndjson --output <path>` was silently dropping
  // the file because the alias rewrite (line 183) clears `opts.report` and
  // the downstream sarif branch is the only place that honoured `--output`.
  // Open a write fd up front and stream events into it instead of stdout
  // when the path is set; we still surface the human summary on stderr so
  // exit-code/UX behaviour matches the stdout-streaming form.
  const ndjsonOutputPath: string | undefined = ndjson && typeof opts.output === "string" && opts.output.length > 0
    ? resolvePath(opts.output)
    : undefined;
  let ndjsonFd: number | undefined;
  let ndjsonEventCount = 0;
  if (ndjsonOutputPath) {
    // Truncate-on-open mirrors the sarif branch (writeFileSync overwrites);
    // re-running with the same --output path produces a fresh artifact
    // rather than appending to a stale one.
    ndjsonFd = openSync(ndjsonOutputPath, "w");
  }
  const ndjsonOnEvent = ndjson
    ? (ndjsonFd !== undefined
        ? (ev: import("../../core/reporter/ndjson.ts").NdjsonEvent) => {
            ndjsonEventCount += 1;
            writeSync(ndjsonFd!, `${JSON.stringify(ev)}\n`);
          }
        : emitToStdout)
    : undefined;

  try {
    const result = await runChecks({
      specPath: specRes.spec,
      baseUrl: baseRes.baseUrl,
      include: splitList(opts.check),
      exclude: splitList(opts.excludeCheck),
      timeoutMs: typeof opts.timeout === "number" ? opts.timeout : undefined,
      authHeaders: Object.keys(authHeaders).length > 0 ? authHeaders : undefined,
      bootstrapCleanupFailed: opts.bootstrapCleanupFailed === true,
      phase: phaseRaw as "examples" | "coverage" | "all",
      allowX00: opts.allowX00 === true,
      mode: modeRaw as "positive" | "negative" | "all",
      operationFilter,
      onEvent: ndjsonOnEvent,
      // ARV-8: bounded concurrency at op-level + optional rate-limiter
      // gating. workers=1 (default) preserves the pre-ARV-8 sequential
      // path inside runPool — same observable behaviour.
      workers,
      rateLimiter,
    });
    const warnings: string[] = [];
    for (const id of result.selection.unknown) {
      warnings.push(`Unknown check: "${id}" — ignored. Run \`zond checks list\` to see registered ids.`);
    }
    // ARV-5: optional SARIF v2.1.0 sidecar for GitHub Code Scanning.
    // Written before any text output so a partial-write failure surfaces
    // before the success line and the exit code.
    if (opts.report === "sarif") {
      const out = opts.output ?? "zond-checks.sarif";
      const absSpec = resolvePath(specRes.spec);
      const specContent = readFileSync(absSpec, "utf8");
      // Make spec uri repo-relative when possible — GitHub Code Scanning
      // links findings to a file in the repo, absolute paths break that.
      const specUri = relativePath(process.cwd(), absSpec) || "spec.json";
      const sarif = generateSarifReport({
        findings: result.data.findings,
        specContent,
        specUri,
        toolVersion: VERSION,
      });
      writeFileSync(resolvePath(out), JSON.stringify(sarif, null, 2));
      if (!json) console.error(`SARIF report written to ${out}`);
    } else if (typeof opts.report === "string") {
      const msg = `Unknown --report format: "${opts.report}". Available: sarif, ndjson (alias for --ndjson)`;
      if (json) printJson(jsonError("checks run", [msg]));
      else printError(msg);
      process.exit(2);
    }

    if (json) {
      printJson(jsonOk("checks run", result.data, warnings.length > 0 ? warnings : undefined));
    } else if (ndjson) {
      // ARV-10: stdout already carries the NDJSON stream (events were
      // flushed inside runChecks via onEvent). Warnings ride on stderr
      // so a `| jq` consumer never sees them; the human one-liner is
      // also routed to stderr to keep stdout discipline (AC #5).
      // ARV-97: when events were redirected to a file via --output, the
      // stdout-discipline rationale doesn't apply, but routing the summary
      // to stderr keeps the contract uniform across the two ndjson modes.
      for (const w of warnings) console.error(w);
      const s = result.data.summary;
      console.error(
        `${s.findings} finding(s) across ${s.cases} case(s) on ${s.operations} operation(s) — ${s.checks_run} check(s) active`,
      );
      const skipLine = formatSkippedOutcomes(s.skipped_outcomes);
      if (skipLine) console.error(skipLine);
      if (ndjsonOutputPath) {
        // Mirror the SARIF branch's "written to" line. Use process.stderr
        // directly (not console.error) so test harnesses that mock the
        // streams without intercepting console pick this up.
        process.stderr.write(`NDJSON report written to ${ndjsonOutputPath} (${ndjsonEventCount} events)\n`);
      }
    } else {
      for (const w of warnings) console.error(w);
      const s = result.data.summary;
      printSuccess(
        `${s.findings} finding(s) across ${s.cases} case(s) on ${s.operations} operation(s) — ${s.checks_run} check(s) active`,
      );
      const skipLine = formatSkippedOutcomes(s.skipped_outcomes);
      if (skipLine) console.log(`  ${skipLine}`);
      // ARV-18: aggregate identical findings (same check + same response
      // status + same severity) so a 30-operation 401-not-in-spec sweep
      // collapses to one row instead of drowning out single-shot findings.
      // Per-operation detail is restored under --verbose; the JSON envelope
      // and SARIF sidecar always carry the full unaggregated list.
      if (opts.verbose) {
        for (const f of result.data.findings) {
          console.log(`  [${f.severity}] ${f.check} ${f.operation.method} ${f.operation.path} — ${f.message}`);
        }
      } else {
        const groups = new Map<string, { severity: string; check: string; status: number; ops: Set<string>; sample: string }>();
        for (const f of result.data.findings) {
          const status = f.response_summary?.status ?? 0;
          const key = `${f.severity}|${f.check}|${status}`;
          const opKey = `${f.operation.method} ${f.operation.path}`;
          let g = groups.get(key);
          if (!g) {
            g = { severity: f.severity, check: f.check, status, ops: new Set(), sample: f.message };
            groups.set(key, g);
          }
          g.ops.add(opKey);
        }
        for (const g of groups.values()) {
          if (g.ops.size <= 1) {
            const op = [...g.ops][0] ?? "(unknown op)";
            console.log(`  [${g.severity}] ${g.check} ${op} — ${g.sample}`);
          } else {
            const stem = g.status > 0
              ? `Status ${g.status} not declared / unexpected`
              : g.sample.replace(/ for [A-Z]+ .+$/, "");
            console.log(`  [${g.severity}] ${g.check} — ${stem} (${g.ops.size} operation${g.ops.size === 1 ? "" : "s"} affected; --verbose for per-op detail)`);
          }
        }
      }
    }
    // Exit-code rule: 0 when no HIGH/CRITICAL findings, 1 otherwise. LOW/MEDIUM
    // findings are reported but don't gate CI by default — agents that want
    // strict gating can post-process the JSON envelope.
    if (ndjsonFd !== undefined) closeSync(ndjsonFd);
    process.exit(result.high_or_critical > 0 ? 1 : 0);
  } catch (err) {
    if (ndjsonFd !== undefined) {
      try { closeSync(ndjsonFd); } catch { /* fd may already be invalid */ }
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (json) printJson(jsonError("checks run", [msg]));
    else printError(msg);
    process.exit(2);
  }
}

function defineList(parent: Command): void {
  parent
    .command("list")
    .description("List all registered checks (id, severity, default expected, references)")
    .action(checksListAction);
}

function defineRun(parent: Command): void {
  parent
    .command("run")
    .description("Run active checks against a live API and emit findings")
    .option("--api <name>", "Use the registered API's spec + .env.yaml")
    .option("--spec <path>", "Explicit OpenAPI spec path (overrides --api)")
    .option("--base-url <url>", "Base URL for requests (overrides --api env file)")
    .option("--check <ids...>", "Only run these checks (comma-separated or repeated)")
    .option("--exclude-check <ids...>", "Skip these checks (comma-separated or repeated)")
    .option("--timeout <ms>", "Per-request timeout in ms", (v) => Number.parseInt(v, 10))
    .option("--db <path>", "SQLite path (for --api lookup)")
    .option(
      "--auth-header <header...>",
      "ARV-3: feed real-auth headers into stateful security checks. Format: 'Name: value'. Repeat for multiple headers. Auto-derived from apis/<name>/.env.yaml (auth_token, api_key) when --api is set.",
    )
    .option(
      "--bootstrap-cleanup-failed",
      "ARV-3: signal that bootstrap-cleanup failed before this run. Stateful security checks (ignored_auth, use_after_free, ensure_resource_availability) skip with a warning to avoid false positives on stale data.",
    )
    .option(
      "--report <format>",
      "ARV-5: emit findings in an extra format alongside the JSON envelope. Available: sarif (SARIF v2.1.0 for GitHub Code Scanning), ndjson (alias for --ndjson — stream events on stdout).",
    )
    .option(
      "--output <path>",
      "ARV-5/ARV-97: write the report to this file. With --report sarif, defaults to zond-checks.sarif. With --report ndjson (or --ndjson), redirects the event stream from stdout into the file (one JSON event per line).",
    )
    .option(
      "--phase <phase>",
      "ARV-6: which case-generation phase to run. examples (default — one positive + single-site negative mutation), coverage (deterministic boundary-value enumeration), all (both).",
      "examples",
    )
    .option(
      "--allow-x00",
      "ARV-6: include the NUL byte (\\x00) in string boundaries during coverage phase. Off by default — some HTTP/JSON stacks panic on it.",
    )
    .option(
      "--mode <mode>",
      "ARV-7: positive (contract verification only — drops checks/cases that send malicious input), negative (only malicious-input probes), all (default — both).",
      "all",
    )
    .option(
      "--include <spec...>",
      "ARV-9: keep only operations matching <selector>:<value>. Selectors: path:<regex>, method:<csv>, tag:<csv>, operation-id:<regex>. Repeat the flag for OR semantics.",
    )
    .option(
      "--exclude <spec...>",
      "ARV-9: drop operations matching <selector>:<value>. Same grammar as --include. Excludes evaluated after includes.",
    )
    .option(
      "--ndjson",
      "ARV-10: stream events as NDJSON on stdout (one JSON object per line). Event types: check_start, check_result, finding, summary. Schema: docs/json-schema/ndjson-events.schema.json. Mutually exclusive with --json/--report.",
    )
    .option(
      "--workers <n>",
      "ARV-8: bounded concurrency at the operation level. <n> = positive integer (clamped 1..64) or `auto` (= min(cpus, 8)). Default 1 (sequential, byte-for-byte the pre-ARV-8 behaviour). Cases inside one operation always run sequentially regardless — only ops are parallelized.",
    )
    .option(
      "--rate-limit <rps>",
      "ARV-8: cap outbound RPS — positive number (fixed budget) or `auto` (adaptive — paces from RateLimit-* response headers, RFC 9568). Combined with --workers, the limiter gates *all* workers globally so N workers never exceed <rps>.",
    )
    .option(
      "--verbose",
      "ARV-18: emit one stdout row per finding instead of aggregating identical findings (same check + same response status). JSON / NDJSON / SARIF outputs always carry the unaggregated list; this flag only controls the human summary.",
    )
    .action(checksRunAction);
}

export function registerChecks(program: Command): void {
  const cmd = program
    .command("checks")
    .description("Run schemathesis-style conformance/security checks against an API");
  defineList(cmd);
  defineRun(cmd);
}

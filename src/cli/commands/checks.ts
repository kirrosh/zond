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
import { resolveBudget, isBudget, BUDGETS, type Budget } from "../../core/checks/budget.ts";
import { generateSarifReport } from "../../core/checks/sarif.ts";
import { emitToStdout, nowIso } from "../../core/reporter/ndjson.ts";
import { parseWorkers } from "../../core/runner/async-pool.ts";
import { createAdaptiveRateLimiter, createRateLimiter, type RateLimiter } from "../../core/runner/rate-limiter.ts";
import { compileOperationFilter } from "../../core/selectors/operation-filter.ts";
import { resolveSpecArg, globalJson, resolveApiCollection } from "../resolve.ts";
import { readResourceMap } from "./discover.ts";
import type { ReadbackDiffConfig, IdempotencyConfig, PaginationConfig, LifecycleConfig, SeedBodyConfig } from "../../core/generator/resources-builder.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { printError, printSuccess } from "../output.ts";
import { SAFE_HELP, LIVE_HELP, resolveLive } from "../safe-live.ts";
import { loadEnvironment } from "../../core/parser/variables.ts";
import { readFixtureGaps, gapIndex } from "../../core/workspace/fixture-gaps.ts";
import { getApi } from "../util/api-context.ts";
import { VERSION } from "../version.ts";
import { resolveOutput, OutputSpecError, type OutputSpec, type ResolvedOutput } from "../../core/output/index.ts";
import type { RunChecksResult } from "../../core/checks/index.ts";
import type { ChecksCaseEvent } from "../../core/checks/runner.ts";
import { beginAuditRun, finalizeAuditRun, checksPersistEnabled, type AuditCaseRecord } from "../../core/audit/persist.ts";
import { readCurrentSession } from "../../core/context/session.ts";
import { getDb } from "../../db/schema.ts";

/**
 * ARV-118 (m-19): typed declaration of every `--report` / `--output` /
 * `--json` combination `zond checks run` supports. Replaces the inline
 * `--report sarif|ndjson` parser + the legacy `--ndjson` boolean + the
 * mutual-exclusion checks that produced ARV-63, ARV-83, ARV-97.
 *
 *   - `console` (default) — human-readable text on stdout.
 *   - `json` — `{ok, command, data}` envelope (`--json` opts into this).
 *   - `ndjson` — streamed events on stdout, one JSON object per line.
 *     `--report ndjson --output <path>` redirects the stream to file
 *     (ARV-97 — no more silent drop).
 *   - `sarif` — SARIF v2.1.0 for GitHub Code Scanning, default file
 *     `zond-checks.sarif` when `--output` is omitted.
 *   - `markdown` — short human-readable summary (file via `--output`
 *     or stdout otherwise).
 */
export const CHECKS_OUTPUT_SPEC: OutputSpec<RunChecksResult> = {
  command: "checks run",
  defaultFormat: "console",
  formats: {
    console:  { defaultChannel: "stdout", description: "Human-readable summary (default)" },
    json:     { defaultChannel: "stdout", envelopeWrap: true, envelopeSchemaFile: "checksRunData.schema.json", description: "JSON envelope ({ok, command, data})" },
    ndjson:   { defaultChannel: "stdout", description: "Stream events on stdout (check_start | check_result | finding | summary)" },
    sarif:    { defaultChannel: "file", defaultFilename: "zond-checks.sarif", description: "SARIF v2.1.0 for GitHub Code Scanning" },
    markdown: { defaultChannel: "stdout", description: "Short markdown summary of findings" },
  },
};

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
  workers?: string;
  rateLimit?: string;
  verbose?: boolean;
  strict405?: boolean;
  strict401?: boolean;
  maxRequests?: number;
  /** ARV-342: operation-window for bounded/resumable sweeps of large specs. */
  maxOps?: number;
  skipOps?: number;
  budget?: string;
  showSuppressed?: boolean;
  /** ARV-308: `--no-fail-on-findings` sets this to false (commander default
   *  true) — keep exit 0 even when HIGH/CRITICAL findings exist so an
   *  orchestrator can distinguish "found drift" from "command failed". */
  failOnFindings?: boolean;
  /** ARV-308: `--advisory` alias for --no-fail-on-findings. */
  advisory?: boolean;
  /** ARV-299: safe/live parity with `audit`. Default safe — mutating
   *  stateful create-chains self-skip; `--live` runs them. */
  safe?: boolean;
  live?: boolean;
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

/** ARV-141: lift filled fixtures from `apis/<name>/.env.yaml` so the runner
 *  can substitute them into path-params. Keeps the result string-only (drops
 *  numeric/object values silently — they can't be URL-encoded path segments
 *  anyway) and skips obvious placeholders so a TODO-string doesn't masquerade
 *  as a real id and produce phantom-200s. */
/**
 * ARV-169: load per-resource overrides for stateful checks. Reads
 * `apis/<name>/.api-resources.yaml` (+ `.local.yaml` overlay through
 * `readResourceMap`) and surfaces each resource's `readback_diff`
 * block keyed by resource name. Returns undefined when no API context
 * is in scope (raw `--spec` invocation without a registered API) so
 * the runner falls back to default ignore patterns.
 */
async function deriveResourceConfigsFromApi(
  apiName: string | undefined,
  dbPath: string | undefined,
): Promise<Map<string, ResourceConfigEntry> | undefined> {
  if (!apiName) return undefined;
  const col = resolveApiCollection(apiName, dbPath);
  if ("error" in col) return undefined;
  if (!col.baseDir) return undefined;
  const map = await readResourceMap(col.baseDir);
  if (!map) return undefined;
  const out = new Map<string, ResourceConfigEntry>();
  for (const r of map.resources) {
    if (!r.readback_diff && !r.idempotency && !r.pagination && !r.lifecycle && !r.seed_body) continue;
    const entry: ResourceConfigEntry = {};
    if (r.seed_body) {
      entry.seedBody = {
        contentType: r.seed_body.content_type,
        body: r.seed_body.body,
      };
    }
    if (r.readback_diff) {
      entry.readbackDiff = {
        ignoreFields: r.readback_diff.ignore_fields,
        writeToReadMap: r.readback_diff.write_to_read_map,
      };
    }
    if (r.idempotency) {
      entry.idempotency = {
        header: r.idempotency.header,
        scope: r.idempotency.scope,
        ignoreResponseFields: r.idempotency.ignore_response_fields,
      };
    }
    if (r.pagination) {
      entry.pagination = {
        type: r.pagination.type,
        cursorParam: r.pagination.cursor_param,
        cursorField: r.pagination.cursor_field,
        hasMoreField: r.pagination.has_more_field,
        limitParam: r.pagination.limit_param,
        defaultLimit: r.pagination.default_limit,
        itemsField: r.pagination.items_field,
        pageParam: r.pagination.page_param,
        startPage: r.pagination.start_page,
      };
    }
    if (r.lifecycle) {
      entry.lifecycle = {
        field: r.lifecycle.field,
        states: r.lifecycle.states,
        transitions: r.lifecycle.transitions,
        actions: Object.fromEntries(
          Object.entries(r.lifecycle.actions).map(([name, a]) => [name, {
            endpoint: a.endpoint,
            expectedState: a.expected_state,
            body: a.body,
          }]),
        ),
      };
    }
    out.set(r.resource, entry);
  }
  return out.size > 0 ? out : undefined;
}

type ResourceConfigEntry = {
  readbackDiff?: ReadbackDiffConfig;
  idempotency?: IdempotencyConfig;
  pagination?: PaginationConfig;
  lifecycle?: LifecycleConfig;
  seedBody?: SeedBodyConfig;
};

async function derivePathVarsFromApi(apiName: string | undefined, dbPath: string | undefined): Promise<Record<string, string>> {
  if (!apiName) return {};
  const col = resolveApiCollection(apiName, dbPath);
  if ("error" in col || !col.baseDir) return {};
  try {
    const env = await loadEnvironment(undefined, col.baseDir);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (typeof v !== "string" || v.length === 0) continue;
      if (k === "base_url" || k === "auth_token" || k === "api_key") continue;
      const trimmed = v.trim().toLowerCase();
      // Mirror prepare-fixtures' placeholder filter — a "string"/"example"
      // value would routinely 404 and undo the whole reactivity point.
      if (trimmed === "" || trimmed === "string" || trimmed === "example") continue;
      if (trimmed.startsWith("todo") || trimmed.startsWith("<")) continue;
      out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** ARV-324: load `.fixture-gaps.yaml` (written by a prior prepare-fixtures/
 *  discover run) so findings on a known-empty/inaccessible operation get
 *  `fix_fixture` instead of `report_backend_bug`. Undefined (not an empty
 *  Set) when there's no API context or no gaps file, so the classifier
 *  can tell "nothing to check" apart from "checked, no gaps". */
async function deriveFixtureGapsFromApi(apiName: string | undefined, dbPath: string | undefined): Promise<Set<string> | undefined> {
  if (!apiName) return undefined;
  const col = resolveApiCollection(apiName, dbPath);
  if ("error" in col || !col.baseDir) return undefined;
  const gaps = await readFixtureGaps(col.baseDir);
  return gaps.length > 0 ? gapIndex(gaps) : undefined;
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

/**
 * ARV-118: minimal markdown render of a `checks run` result. Mirrors the
 * console summary line + a grouped findings list. Kept deliberately small —
 * SARIF / JSON envelope remain the canonical machine-readable artifacts.
 */
function renderMarkdownReport(
  data: RunChecksResult["data"],
  warnings: string[],
): string {
  const s = data.summary;
  const lines: string[] = [];
  lines.push(`# zond checks report`);
  lines.push("");
  lines.push(
    `**${s.findings} finding(s)** across ${s.cases} case(s) on ${s.operations} operation(s) — ${s.checks_run} check(s) active`,
  );
  // ARV-251: per-category roll-up. Small teams use this to triage —
  // "0 security, 12 reliability" is a clear starting point compared to
  // a flat severity pile.
  if (s.findings > 0) {
    const c = s.by_category;
    lines.push("");
    lines.push(
      `🛡 security: ${c.security} · ⚙ reliability: ${c.reliability} · 📜 contract: ${c.contract} · · hygiene: ${c.hygiene}`,
    );
  }
  const skipLine = formatSkippedOutcomes(s.skipped_outcomes);
  if (skipLine) {
    lines.push("");
    lines.push(skipLine);
  }
  if (warnings.length > 0) {
    lines.push("");
    lines.push(`## Warnings`);
    for (const w of warnings) lines.push(`- ${w}`);
  }
  if (data.findings.length > 0) {
    lines.push("");
    lines.push(`## Findings`);
    for (const f of data.findings) {
      const cat = f.category ? ` _${f.category}_` : "";
      lines.push(
        `- **[${f.severity}]**${cat} \`${f.check}\` ${f.operation.method} ${f.operation.path} — ${f.message}`,
      );
    }
  }
  return lines.join("\n") + "\n";
}

function splitList(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  return values.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean);
}

// ARV-211 (R13/F15): expand the `stateful` keyword in --check / --exclude-check
// into the full set of stateful check ids registered in core/checks/stateful.ts.
// This lets users (and the zond-checks SKILL.md DEPTH-PASS step) write
//   zond checks run --check stateful
// instead of hand-listing cross_call_references, idempotency_replay, … —
// matching the prior `--phase stateful` UX promise without overloading the
// case-generation `--phase` flag.
// ARV-325: `ignored_auth` / `open_cors_on_sensitive` live in the stateful
// *registry* (they need the stateful harness to run), but semantically they
// are auth/security checks. Users reading `--check stateful` expect
// state-machine probes, not a full security pass — on Stripe the pair added
// ~520 extra cases and turned a sub-minute run into ~10 minutes. Keep them
// runnable by explicit id; just don't smuggle them in through the alias.
const STATEFUL_ALIAS_EXCLUDED: ReadonlySet<string> = new Set([
  "ignored_auth",
  "open_cors_on_sensitive",
]);

export function expandStatefulAlias(ids: string[] | undefined): string[] | undefined {
  if (!ids) return ids;
  const statefulIds = listStatefulChecks()
    .map((c) => c.id)
    .filter((id) => !STATEFUL_ALIAS_EXCLUDED.has(id));
  const out: string[] = [];
  for (const id of ids) {
    if (id === "stateful") out.push(...statefulIds);
    else out.push(id);
  }
  return out;
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

  // ARV-118 (m-19): single source of truth for `--report` / `--output` /
  // `--json` resolution. resolveOutput enforces mutual exclusion of
  // `--json` and `--report`, validates the format name against the spec
  // (ARV-97 — no silent acceptance), and computes the channel + path.
  // The legacy `--ndjson` boolean and the inline alias rewrite are gone —
  // `--report ndjson` is now a first-class format key.
  let resolved: ResolvedOutput;
  try {
    resolved = resolveOutput(CHECKS_OUTPUT_SPEC, {
      report: opts.report,
      output: opts.output,
      json,
    });
  } catch (err) {
    if (err instanceof OutputSpecError) {
      if (json) printJson(jsonError("checks run", [err.message]));
      else printError(err.message);
      process.exit(2);
    }
    throw err;
  }
  const ndjson = resolved.format === "ndjson";

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

  // ARV-141: feed filled fixtures into path-params so the run reacts to
  // fixture-pack growth (otherwise findings/skips are pixel-identical across
  // rounds and CI can't distinguish "spec stable" from "checks ignored deltas").
  const pathVars = await derivePathVarsFromApi(apiName, opts.db);
  const resourceConfigs = await deriveResourceConfigsFromApi(apiName, opts.db);
  const fixtureGaps = await deriveFixtureGapsFromApi(apiName, opts.db);

  const phaseRaw = typeof opts.phase === "string" ? opts.phase : "examples";
  if (phaseRaw !== "examples" && phaseRaw !== "coverage" && phaseRaw !== "all") {
    // ARV-211: redirect users typing --phase stateful (a common skill drift)
    // to the canonical alias `--check stateful`.
    const hint = phaseRaw === "stateful"
      ? " — stateful checks are a separate family; run them with `--check stateful` (or list individual ids)"
      : "";
    const msg = `Unknown --phase: "${phaseRaw}". Available: examples, coverage, all${hint}`;
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

  // ARV-97 (F2 / m-19): when `ndjson` lands in the file channel, open a
  // write fd up front and pipe events into it; otherwise emit on stdout.
  // Re-running with the same --output truncates (mirrors SARIF) so a
  // stale artifact can't leak across runs.
  const ndjsonOutputPath: string | undefined = ndjson && resolved.channel === "file" ? resolved.path : undefined;
  let ndjsonFd: number | undefined;
  let ndjsonEventCount = 0;
  let ndjsonLastFullyWritten = true;
  if (ndjsonOutputPath) {
    ndjsonFd = openSync(ndjsonOutputPath, "w");
  }
  // ARV-343: accumulate a running summary from the stream so a SIGTERM'd
  // run still emits a terminal `summary` line (operations/cases counted so
  // far) instead of dying before the runner's emit stage — triage's
  // `sweepWindows`/status-dist read `.summary.operations` and had to
  // reconstruct it from raw NDJSON when the window was killed mid-flight.
  const partialOps = new Set<string>();
  const partialChecks = new Set<string>();
  let partialCases = 0;
  let partialFindings = 0;
  const partialBySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const accumulate = (ev: import("../../core/reporter/ndjson.ts").NdjsonEvent) => {
    if (ev.type === "check_result") {
      partialCases += 1;
      partialChecks.add(ev.check);
      partialOps.add(`${ev.operation.method} ${ev.operation.path}`);
    } else if (ev.type === "check_start") {
      partialOps.add(`${ev.operation.method} ${ev.operation.path}`);
    } else if (ev.type === "finding") {
      partialFindings += 1;
      const sev = ev.finding.severity as keyof typeof partialBySeverity;
      if (sev in partialBySeverity) partialBySeverity[sev] += 1;
    }
  };
  const ndjsonOnEvent = ndjson
    ? (ndjsonFd !== undefined
        ? (ev: import("../../core/reporter/ndjson.ts").NdjsonEvent) => {
            accumulate(ev);
            ndjsonLastFullyWritten = false;
            ndjsonEventCount += 1;
            writeSync(ndjsonFd!, `${JSON.stringify(ev)}\n`);
            ndjsonLastFullyWritten = true;
          }
        // ARV-323: count stdout-channel events too — the SIGTERM handler
        // reports `ndjsonEventCount`, and with a shell-redirected stdout
        // stream it claimed "0 event(s) flushed" while the redirect target
        // already held thousands of lines.
        : (ev: import("../../core/reporter/ndjson.ts").NdjsonEvent) => {
            accumulate(ev);
            ndjsonEventCount += 1;
            emitToStdout(ev);
          })
    : undefined;

  // ARV-230: clean SIGTERM/SIGINT shutdown for NDJSON streams. Without
  // this, killing a long `checks run --report ndjson` leaves a truncated
  // last line in the file (or in the consumer's pipe) and downstream
  // `jq -s` chokes until the user strips it with `sed '$d'`. The handler
  // closes the fd (or drains stdout) and exits with the conventional
  // 128+signo code instead of letting Node default-terminate mid-write.
  let removeNdjsonSigHandlers: (() => void) | undefined;
  if (ndjson) {
    const shutdown = (signo: number) => {
      try {
        // ARV-343: flush a partial terminal summary from the running
        // accumulators. Schema-exact (CheckRunSummarySchema) so downstream
        // `jq '.summary.operations'` and status-dist stay analyzable;
        // by_category/skipped are left empty (not derivable in the CLI) —
        // the stderr interrupt note below flags that it's a partial count.
        const partialSummary = {
          type: "summary" as const,
          ts: nowIso(),
          summary: {
            operations: partialOps.size,
            cases: partialCases,
            checks_run: partialChecks.size,
            findings: partialFindings,
            by_severity: { ...partialBySeverity },
            by_category: { security: 0, reliability: 0, contract: 0, hygiene: 0 },
            skipped_outcomes: {},
            skipped_outcomes_grouped: [],
          },
        };
        if (ndjsonFd !== undefined) {
          if (!ndjsonLastFullyWritten) {
            try { writeSync(ndjsonFd, "\n"); } catch { /* fd already gone */ }
          }
          try { writeSync(ndjsonFd, `${JSON.stringify(partialSummary)}\n`); } catch { /* fd already gone */ }
          try { closeSync(ndjsonFd); } catch { /* already closed */ }
          ndjsonFd = undefined;
        } else {
          try { emitToStdout(partialSummary); } catch { /* stdout gone */ }
        }
      } catch { /* swallow; we're tearing down */ }
      // ARV-323: "emitted" not "flushed" — on the stdout channel the last
      // few lines may still sit in the pipe buffer, so the count is a
      // lower bound of what the consumer/file will contain, never an
      // excuse to discard a partial-but-real stream.
      try { process.stderr.write(`zond: NDJSON run interrupted (signal ${signo}); ${ndjsonEventCount} event(s) + a partial summary (${partialOps.size} ops, ${partialCases} cases so far) emitted before interrupt (partial stream is usable).\n`); } catch { /* ignore */ }
      process.exit(128 + signo);
    };
    const onTerm = () => shutdown(15);
    const onInt = () => shutdown(2);
    process.on("SIGTERM", onTerm);
    process.on("SIGINT", onInt);
    removeNdjsonSigHandlers = () => {
      process.off("SIGTERM", onTerm);
      process.off("SIGINT", onInt);
    };
  }

  // ARV-265: accumulate every HTTP case `runChecks` dispatches so we can
  // persist them into the run/results tables after the run completes. The
  // adapter maps ChecksCaseEvent → AuditCaseRecord (1:1) and groups by
  // synthetic suite path (`apis/<api>/checks/<phase>`) so `detectRunKind`
  // would still classify these rows as `check`-kind on legacy queries.
  const auditPersist = checksPersistEnabled();
  const auditCases: AuditCaseRecord[] = [];
  const auditSuiteRoot = `apis/${apiName ?? "_"}/checks`;
  const onCase = auditPersist
    ? (ev: ChecksCaseEvent) => {
        const phaseLabel = ev.phase === "response" ? "response" : ev.phase.replace("stateful_", "stateful/");
        const suiteFile = `${auditSuiteRoot}/${phaseLabel}.yaml`;
        const status = ev.verdict === "pass" ? "pass"
          : ev.verdict === "fail" ? "fail"
          : ev.verdict === "skip" ? "skip"
          : "error";
        auditCases.push({
          suiteName: `checks/${phaseLabel}`,
          suiteFile,
          testName: `${ev.checkId}::${ev.operation.method.toUpperCase()} ${ev.operation.path}`,
          status,
          request: ev.request,
          ...(ev.response ? { response: ev.response } : {}),
          durationMs: ev.durationMs,
          ...(ev.error ? { error: ev.error } : {}),
        });
      }
    : undefined;

  let budget: Budget | undefined;
  if (opts.budget !== undefined) {
    if (!isBudget(opts.budget)) {
      printError(`--budget must be one of: ${BUDGETS.join(", ")}; got '${opts.budget}'`);
      process.exit(1);
    }
    budget = opts.budget;
  }
  const includeList = expandStatefulAlias(splitList(opts.check));
  const statefulIds = new Set(listStatefulChecks().map((c) => c.id));
  const includesStateful = includeList?.some((id) => statefulIds.has(id)) === true;
  const budgetResolved = resolveBudget(budget, opts.maxRequests, {
    forceStatefulIfIncluded: includesStateful,
  });

  // ARV-328: throttled progress line on stderr during long runs (CI jobs
  // and subagents with wall-clock budgets had zero visibility — the only
  // artifact was the growing ndjson file). stderr never corrupts stdout
  // reports; 10s throttle keeps short runs silent.
  const PROGRESS_INTERVAL_MS = 10_000;
  let lastProgressAt = Date.now();
  const onProgress = (p: { done: number; total: number; cases: number }) => {
    const now = Date.now();
    if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    try {
      process.stderr.write(`zond: progress — ${p.done}/${p.total} operations, ${p.cases} case(s) run\n`);
    } catch { /* ignore */ }
  };

  try {
    const result = await runChecks({
      specPath: specRes.spec,
      baseUrl: baseRes.baseUrl,
      include: includeList,
      exclude: expandStatefulAlias(splitList(opts.excludeCheck)),
      timeoutMs: typeof opts.timeout === "number" ? opts.timeout : undefined,
      authHeaders: Object.keys(authHeaders).length > 0 ? authHeaders : undefined,
      pathVars: Object.keys(pathVars).length > 0 ? pathVars : undefined,
      fixtureGaps,
      resourceConfigs,
      bootstrapCleanupFailed: opts.bootstrapCleanupFailed === true,
      phase: phaseRaw as "examples" | "coverage" | "all",
      allowX00: opts.allowX00 === true,
      strict405: opts.strict405 === true,
      strict401: opts.strict401 === true,
      mode: modeRaw as "positive" | "negative" | "all",
      operationFilter,
      onEvent: ndjsonOnEvent,
      onCase,
      onProgress,
      // ARV-8: bounded concurrency at op-level + optional rate-limiter
      // gating. workers=1 (default) preserves the pre-ARV-8 sequential
      // path inside runPool — same observable behaviour.
      workers,
      rateLimiter,
      maxRequests: budgetResolved.maxRequests,
      skipStateful: budgetResolved.skipStateful,
      maxOps: opts.maxOps,
      skipOps: opts.skipOps,
      safe: !resolveLive(opts),
    });

    // ARV-265: persist the accumulated cases as a `run_kind='check'` run
    // so `zond coverage --scope audit` can count them. Failures here
    // degrade to a warning — the user's primary command already succeeded.
    if (auditPersist && auditCases.length > 0) {
      try {
        getDb(opts.db);
        const { findCollectionByNameOrId } = await import("../../db/queries.ts");
        const collectionId = apiName ? findCollectionByNameOrId(apiName)?.id : undefined;
        const session = readCurrentSession();
        const runId = beginAuditRun({
          runKind: "check",
          ...(collectionId != null ? { collectionId } : {}),
          ...(session?.id ? { sessionId: session.id } : {}),
          tags: ["checks", `phase:${phaseRaw}`, `mode:${modeRaw}`],
        });
        finalizeAuditRun(runId, auditCases);
      } catch (err) {
        // Audit persistence is best-effort. Surface the failure on stderr
        // so an agent can detect it (the missing audit-coverage downstream
        // will already point them here) without breaking the run.
        const msg = (err as Error).message;
        process.stderr.write(`zond: audit persistence failed (${msg}). Re-run with ZOND_CHECKS_PERSIST=0 to silence.\n`);
      }
    }
    const warnings: string[] = [];
    for (const id of result.selection.unknown) {
      warnings.push(`Unknown check: "${id}" — ignored. Run \`zond checks list\` to see registered ids.`);
    }
    // ARV-5 / ARV-118: SARIF v2.1.0 sidecar — file channel always (default
    // filename `zond-checks.sarif` is set by the OutputSpec). Written before
    // any text output so a partial-write failure surfaces before the success
    // line and the exit code.
    if (resolved.format === "sarif") {
      const out = resolved.path!;
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
      writeFileSync(out, JSON.stringify(sarif, null, 2));
      console.error(`SARIF report written to ${out}`);
      for (const w of warnings) console.error(w);
    } else if (resolved.format === "markdown") {
      const body = renderMarkdownReport(result.data, warnings);
      if (resolved.channel === "file") {
        writeFileSync(resolved.path!, body);
        console.error(`Markdown report written to ${resolved.path}`);
      } else {
        process.stdout.write(body);
      }
    } else if (resolved.format === "json") {
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
      // ARV-251: per-category roll-up. Surfaces "0 security, 12
      // reliability" so a triager sees where the volume sits before
      // scrolling the finding list.
      if (s.findings > 0) {
        const c = s.by_category;
        console.log(
          `  🛡 security: ${c.security}  ⚙ reliability: ${c.reliability}  📜 contract: ${c.contract}  · hygiene: ${c.hygiene}`,
        );
      }
      const skipLine = formatSkippedOutcomes(s.skipped_outcomes);
      if (skipLine) console.log(`  ${skipLine}`);
      // ARV-60: spec-level rollup. When the runner detected ≥80% of a
      // check's applicable ops sharing one root cause, print one summary
      // row with an actionable fix hint instead of N per-op rows that
      // all say the same thing. `--verbose` always shows per-op detail
      // (and JSON/SARIF carry the full unaggregated list regardless).
      const rolledUpOps = new Set<string>();
      if (!opts.verbose) {
        for (const sf of result.data.spec_findings) {
          if (sf.kind === "status_drift") {
            for (const op of sf.affected_operations) {
              rolledUpOps.add(`${sf.check}|${op.method} ${op.path}`);
            }
            console.log(
              `  [${sf.severity}] ${sf.check} — ${sf.reason} (${sf.count}/${sf.applicable} operations)`,
            );
            console.log(`         → ${sf.fix_hint}`);
          } else {
            // missing_declaration / no_detector / other — no affected_operations
            // to enumerate; surfaces as a single info row + fix hint.
            const tag = sf.kind === "no_detector"
              ? `${sf.count === 0 ? "0 cases" : `${sf.count} cases`} / ${sf.applicable} applicable ops`
              : `${sf.count}/${sf.applicable} cases`;
            console.log(`  [${sf.severity}] ${sf.check} — ${sf.reason} (${tag})`);
            console.log(`         → ${sf.fix_hint}`);
          }
        }
      }
      // ARV-283 AC#4: suppressed findings stay in the ndjson audit-trail
      // but are hidden from the human summary unless `--show-suppressed`
      // is passed. They never count toward CI gates regardless.
      const activeFindings = result.data.findings.filter((f) => !f.suppressed_by);
      const suppressedFindings = result.data.findings.filter((f) => f.suppressed_by);

      // Per-op findings — skip those already covered by a status_drift
      // rollup unless --verbose was passed.
      if (opts.verbose) {
        for (const f of activeFindings) {
          console.log(`  [${f.severity}] ${f.check} ${f.operation.method} ${f.operation.path} — ${f.message}`);
        }
      } else {
        // ARV-18: dedup identical findings on the SAME op (multiple cases
        // hitting the same gap) before printing. Spec-rollup above already
        // handled the across-op clusters; this collapses the within-op
        // duplicates so the human summary stays readable even when boundary
        // mutations each trip the same status.
        const seen = new Set<string>();
        for (const f of activeFindings) {
          const opKey = `${f.check}|${f.operation.method} ${f.operation.path}`;
          if (rolledUpOps.has(opKey)) continue;
          const dedupKey = `${f.severity}|${opKey}|${f.response_summary?.status ?? 0}|${f.message}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          console.log(`  [${f.severity}] ${f.check} ${f.operation.method} ${f.operation.path} — ${f.message}`);
        }
      }

      if (opts.showSuppressed && suppressedFindings.length > 0) {
        console.log(`\nSuppressed (${suppressedFindings.length}, not counted in summary):`);
        for (const f of suppressedFindings) {
          const sb = f.suppressed_by!;
          console.log(`  [${f.severity}] ${f.check} ${f.operation.method} ${f.operation.path} — ${f.message}`);
          console.log(`         ↳ suppressed by ${sb.source}#${sb.rule_index}: ${sb.reason}`);
        }
      }
    }
    // Exit-code rule: 0 when no HIGH/CRITICAL findings, 1 otherwise. LOW/MEDIUM
    // findings are reported but don't gate CI by default — agents that want
    // strict gating can post-process the JSON envelope.
    //
    // ARV-308: --no-fail-on-findings / --advisory keeps exit 0 even with
    // HIGH/CRITICAL findings, mirroring `zond run --no-fail-on-failures`, so
    // an orchestrator can tell "found drift" (exit 0, findings in envelope)
    // from "command failed" (exit 2). The stderr tail still names the count.
    const advisory = opts.advisory === true || opts.failOnFindings === false;
    // ARV-320: this used to skip on ndjson under the assumption that "stderr
    // already carried the summary just above" — false for ndjson, which takes
    // a separate branch that only ever writes "NDJSON report written to
    // <path>" to stderr. Under `--report ndjson` + `set -e` in CI, that made
    // exit 1 look unexplained (report-zond friction on the 2026-07-02 Stripe
    // run: "this step will 'fail' silently with valid data sitting right
    // there"). Always write the reason to stderr — it's stderr, not stdout,
    // so ndjson's stdout-discipline (AC#5) is untouched.
    if (result.high_or_critical > 0) {
      const suffix = advisory
        ? " — advisory mode, exiting 0 (findings are in the envelope)"
        : " — exiting with code 1 (pass --no-fail-on-findings / --advisory to suppress, e.g. for advisory runs)";
      process.stderr.write(
        `zond: ${result.high_or_critical} HIGH/CRITICAL finding(s)${suffix}.\n`,
      );
    }
    if (ndjsonFd !== undefined) closeSync(ndjsonFd);
    removeNdjsonSigHandlers?.();
    process.exit(result.high_or_critical > 0 && !advisory ? 1 : 0);
  } catch (err) {
    if (ndjsonFd !== undefined) {
      try { closeSync(ndjsonFd); } catch { /* fd may already be invalid */ }
    }
    removeNdjsonSigHandlers?.();
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
    .option("--check <ids...>", "Only run these checks (comma-separated or repeated). 'stateful' expands to the state-machine set: use_after_free, ensure_resource_availability, cross_call_references, idempotency_replay, pagination_invariants, lifecycle_transitions, cursor_boundary_fuzzing — NOT ignored_auth/open_cors_on_sensitive (run those by explicit id)")
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
      "ARV-118: output format. Available: console (default — human summary), json (envelope; equivalent to --json), ndjson (stream events on stdout — check_start | check_result | finding | summary), sarif (SARIF v2.1.0 for GitHub Code Scanning), markdown (short summary).",
    )
    .option(
      "--output <path>",
      "ARV-118: write the report to this file. With --report sarif, defaults to zond-checks.sarif when omitted. With --report ndjson, redirects the event stream from stdout into the file (one JSON event per line).",
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
    .option(
      "--strict-405",
      "ARV-179: require exactly 405 for `unsupported_method` (mirrors schemathesis V4 default). Off by default — zond's pragmatic policy also accepts 401/403/404 as valid rejections of an undeclared method.",
    )
    .option(
      "--strict-401",
      "ARV-181: require exactly 401 for `ignored_auth` no-auth / bogus-auth probes (mirrors schemathesis V4). Off by default — zond's pragmatic policy accepts any 4xx as a valid auth-reject.",
    )
    .option(
      "--max-requests <n>",
      "ARV-227: hard cap on outbound HTTP requests for the whole run (per-response + stateful share the same budget). Once reached, remaining cases short-circuit with `max-requests-cap-reached` in summary.skipped_outcomes. Always wins over the --budget tier cap.",
      (v) => Number.parseInt(v, 10),
    )
    .option(
      "--max-ops <n>",
      "ARV-342: cap this run to N operations (deterministic op-window). Pair with --skip-ops to sweep a large spec in bounded, resumable slices that each finish in a short budget. A window whose summary.operations < N is the last slice.",
      (v) => Number.parseInt(v, 10),
    )
    .option(
      "--skip-ops <n>",
      "ARV-342: skip the first N operations (post-filter, deterministic order) before applying --max-ops. Resume token for windowed sweeps: skip 0, skip 50, skip 100, …",
      (v) => Number.parseInt(v, 10),
    )
    .option(
      "--budget <tier>",
      "ARV-292: adaptive cap and stateful gating tier. `quick` (cap 50, skip stateful) → ~60-sec gate. `standard` (cap 500, all checks). `full` (uncapped). Omitted ⇒ legacy uncapped behaviour. --max-requests always overrides the tier cap; `--check stateful` opts back into stateful even under `quick`.",
    )
    .option(
      "--show-suppressed",
      "Show findings suppressed by the deterministic broken-baseline guard in the text summary (with their suppressed_by trace). Suppressed findings stay in the ndjson/JSON audit-trail regardless of this flag and never count toward CI exit codes.",
    )
    .option(
      "--no-fail-on-findings",
      "ARV-308: keep exit code 0 even when HIGH/CRITICAL findings exist (advisory runs). Mirrors `zond run --no-fail-on-failures`. Lets an orchestrator distinguish 'found drift' (exit 0) from 'command failed' (exit 2). Default: exit 1 on any HIGH/CRITICAL finding.",
    )
    .option(
      "--advisory",
      "ARV-308: alias for --no-fail-on-findings.",
    )
    .option("--safe", SAFE_HELP)
    .option("--live", LIVE_HELP)
    .action(checksRunAction);
}

export function registerChecks(program: Command): void {
  const cmd = program
    .command("checks")
    .description("Run schemathesis-style conformance/security checks against an API");
  defineList(cmd);
  defineRun(cmd);
}

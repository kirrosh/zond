#!/usr/bin/env bun
/**
 * ARV-128 (m-19): diff `zond audit --json` output against a stored
 * baseline and exit non-zero on the regression signal that the
 * nightly workflow cares about — a NEW HIGH finding whose
 * `recommended_action !== "report_backend_bug"`.
 *
 * Why filter on `recommended_action`. `report_backend_bug` is the
 * classifier's verdict that the upstream API misbehaved (5xx, contract
 * violation, etc.) — that's a Sentry-side regression we report via the
 * fb-loop's existing Slack hooks elsewhere, not a zond-side regression
 * we should page on. Every other recommended_action (`fix_fixture`,
 * `add_anti_fp`, `update_check`, …) routes the agent back into zond
 * itself, which IS the signal this workflow is built to catch.
 *
 * Identity. Findings are keyed by `{check_id, endpoint, severity}`
 * with `endpoint = "${method} ${path}"`. Same key in both files = same
 * finding, regardless of message text drift (HTTP body excerpts shift
 * between runs and should not register as new findings).
 *
 * Output is GitHub-Actions-friendly: `::error` annotations per new
 * finding, `::notice` annotations for findings that disappeared,
 * exit code 1 when any new high lands; exit 0 when the run is clean
 * or when only resolved findings show up.
 */
import { readFileSync, existsSync } from "node:fs";
import { argv, exit } from "node:process";

interface RawFinding {
  check_id?: string;
  rule?: string;
  ruleId?: string;
  severity?: string;
  endpoint?: string;
  method?: string;
  path?: string;
  recommended_action?: string;
  message?: string;
}

interface NormalisedFinding {
  key: string;
  check_id: string;
  endpoint: string;
  severity: string;
  recommended_action: string;
  message: string;
}

function parseArgs(args: string[]): { current: string; baseline: string } {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if ((a === "--current" || a === "--baseline") && i + 1 < args.length) {
      out[a.slice(2)] = args[++i]!;
    }
  }
  if (!out.current || !out.baseline) {
    console.error("usage: fb-loop-diff.ts --current <audit.json> --baseline <baseline.json>");
    exit(2);
  }
  return out as { current: string; baseline: string };
}

function loadFindings(path: string): NormalisedFinding[] {
  if (!existsSync(path)) {
    console.error(`fb-loop-diff: file not found: ${path}`);
    exit(2);
  }
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as
    | { findings?: RawFinding[]; data?: { findings?: RawFinding[] } }
    | RawFinding[];
  const raw = Array.isArray(parsed)
    ? parsed
    : parsed.findings ?? parsed.data?.findings ?? [];
  return raw.map(normalise);
}

function normalise(f: RawFinding): NormalisedFinding {
  const check_id = f.check_id ?? f.rule ?? f.ruleId ?? "unknown";
  const endpoint =
    f.endpoint ?? (f.method && f.path ? `${f.method.toUpperCase()} ${f.path}` : "unknown");
  const severity = (f.severity ?? "unknown").toLowerCase();
  const recommended_action = f.recommended_action ?? "unknown";
  const message = f.message ?? "";
  return {
    key: `${check_id}|${endpoint}|${severity}`,
    check_id,
    endpoint,
    severity,
    recommended_action,
    message,
  };
}

function main(): void {
  const { current, baseline } = parseArgs(argv.slice(2));
  const cur = loadFindings(current);
  const base = loadFindings(baseline);

  const baseKeys = new Set(base.map((f) => f.key));
  const curKeys = new Set(cur.map((f) => f.key));

  const newFindings = cur.filter((f) => !baseKeys.has(f.key));
  const resolved = base.filter((f) => !curKeys.has(f.key));

  // The regression signal: NEW + severity:high + action != report_backend_bug.
  const regressions = newFindings.filter(
    (f) => f.severity === "high" && f.recommended_action !== "report_backend_bug",
  );

  for (const f of resolved) {
    console.log(`::notice::resolved finding: ${f.check_id} on ${f.endpoint} (was ${f.severity})`);
  }
  for (const f of newFindings) {
    const severity = f.severity === "high" ? "error" : "warning";
    console.log(
      `::${severity}::new ${f.severity} finding: ${f.check_id} on ${f.endpoint} ` +
        `(recommended_action=${f.recommended_action})`,
    );
  }

  if (regressions.length > 0) {
    console.error(
      `\nfb-loop-diff: ${regressions.length} new HIGH finding(s) with a non-report_backend_bug action — zond-side regression.`,
    );
    for (const f of regressions) {
      console.error(
        `  - ${f.check_id} :: ${f.endpoint} :: action=${f.recommended_action}` +
          (f.message ? ` :: ${f.message}` : ""),
      );
    }
    exit(1);
  }

  console.log(
    `\nfb-loop-diff: clean (new=${newFindings.length}, resolved=${resolved.length}, ` +
      `regressions=0).`,
  );
}

main();

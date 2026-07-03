/**
 * `zond probe webhooks` (m-20 ARV-173) — offline shape-conformance for
 * captured webhook events.
 *
 * Wire-up note: this probe is offline — it reads an ndjson event log,
 * never opens a socket. m-20 keeps live receivers in the recipe
 * (docs/recipes/webhook-receiver.md). The CLI surface is thin:
 *
 *   zond probe webhooks --api stripe --event-log events.jsonl
 *   zond probe webhooks --api stripe --event-log events.jsonl --json
 *   zond probe webhooks --api stripe --event-log events.jsonl --report json --output drift.json
 *
 * Exit code 0 when zero findings, 1 when any HIGH (shape drift) is
 * present, 2 on CLI / IO error. Low-severity findings (unknown event
 * type, missing payload, malformed line) don't gate CI by default.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { jsonOk, jsonError, printJson } from "../../json-envelope.ts";
import { printError, printSuccess, printWarning } from "../../output.ts";
import { parseEventLog, runWebhooksProbe, type WebhookFinding } from "../../../core/probe/webhooks-probe.ts";
import { findWorkspaceRoot } from "../../../core/workspace/root.ts";
import { loadSeverityConfig, SeverityConfigError } from "../../../core/severity/loader.ts";
import { calibrateProbeSeverity } from "../../../core/severity/probe-adapter.ts";
import type { MergedConfig } from "../../../core/severity/config.ts";

export interface ProbeWebhooksOptions {
  specPath: string;
  eventLog: string;
  /** Comma-separated event types to restrict to. Empty ⇒ all declared. */
  only?: string;
  /** OutputSpec — render markdown by default; `--report json` swaps. */
  report?: "markdown" | "json";
  /** When set, the rendered body lands in this file instead of stdout. */
  output?: string;
  /** Envelope mode — wraps result in {ok, command, data, errors}. */
  json?: boolean;
  /** ARV-311: API name for per-api `.zond/severity.yaml` resolution. */
  apiName?: string;
}

/** ARV-311: calibrate each webhook finding's severity in-place through the
 *  shared probe adapter (ARV-300), keyed by the finding kind so a
 *  `.zond/severity.yaml` rule can target `when.finding.check: shape_drift`.
 *  No-op when `config` is empty. */
function calibrateWebhookFindings(findings: WebhookFinding[], config: MergedConfig | undefined): void {
  if (!config) return;
  for (const f of findings) {
    const cal = calibrateProbeSeverity(
      {
        check: f.kind,
        severity: f.severity,
        context: {
          finding: { check: f.kind, message: f.message },
          operation: { method: "POST", path: f.event_type ?? "" },
          response: { status: 0, headers: {} },
        },
      },
      config,
    );
    f.severity = cal.severity as "high" | "low";
    if (cal.suppressed_by) f.suppressed_by = cal.suppressed_by;
  }
}

function severityCount(findings: WebhookFinding[]): { high: number; low: number } {
  let high = 0, low = 0;
  for (const f of findings) (f.severity === "high" ? high += 1 : low += 1);
  return { high, low };
}

function formatMarkdown(spec: unknown, result: ReturnType<typeof runWebhooksProbe>, eventLog: string): string {
  const lines: string[] = [];
  lines.push(`# zond probe webhooks — ${eventLog}`);
  lines.push("");
  if (result.skip_reason) {
    lines.push(`> skipped: ${result.skip_reason}`);
    return lines.join("\n") + "\n";
  }
  const sev = severityCount(result.findings);
  lines.push(`**Events analysed**: ${result.total_events}`);
  lines.push(`**Declared event types**: ${result.declared_events.length} (${result.declared_events.slice(0, 5).join(", ")}${result.declared_events.length > 5 ? ", …" : ""})`);
  lines.push(`**Findings**: ${result.findings.length} (HIGH: ${sev.high}, LOW: ${sev.low})`);
  lines.push("");
  if (Object.keys(result.by_type).length > 0) {
    lines.push("## Per-type breakdown");
    lines.push("");
    lines.push("| Event | ok | drift | unknown |");
    lines.push("|---|---:|---:|---:|");
    const types = Object.keys(result.by_type).sort();
    for (const t of types) {
      const b = result.by_type[t]!;
      lines.push(`| ${t} | ${b.ok} | ${b.drift} | ${b.unknown} |`);
    }
    lines.push("");
  }
  if (result.findings.length > 0) {
    lines.push("## Findings");
    lines.push("");
    for (const f of result.findings.slice(0, 20)) {
      lines.push(`- **${f.kind}** [${f.severity}] (line ${f.line}, type=\`${f.event_type ?? "?"}\`): ${f.message}`);
    }
    if (result.findings.length > 20) lines.push(`\n…and ${result.findings.length - 20} more.`);
  }
  // unused param: keep `spec` to keep the call-site informative; the
  // probe core already mined what it needed.
  void spec;
  return lines.join("\n") + "\n";
}

export async function probeWebhooksCommand(options: ProbeWebhooksOptions): Promise<number> {
  try {
    const eventLogPath = resolvePath(options.eventLog);
    let eventLogText: string;
    try {
      eventLogText = await readFile(eventLogPath, "utf-8");
    } catch (e) {
      const msg = `Cannot read --event-log "${options.eventLog}": ${(e as Error).message}`;
      if (options.json) printJson(jsonError("probe-webhooks", [msg]));
      else printError(msg);
      return 2;
    }

    let specText: string;
    try {
      specText = await readFile(options.specPath, "utf-8");
    } catch (e) {
      const msg = `Cannot read spec at "${options.specPath}": ${(e as Error).message}`;
      if (options.json) printJson(jsonError("probe-webhooks", [msg]));
      else printError(msg);
      return 2;
    }
    let spec: unknown;
    try {
      spec = JSON.parse(specText);
    } catch (e) {
      const msg = `Spec is not valid JSON: ${(e as Error).message}`;
      if (options.json) printJson(jsonError("probe-webhooks", [msg]));
      else printError(msg);
      return 2;
    }

    const { events, malformed } = parseEventLog(eventLogText);
    const onlyTypes = options.only ? options.only.split(",").map(s => s.trim()).filter(Boolean) : undefined;
    const result = runWebhooksProbe({ events, spec, onlyTypes });
    // Prepend malformed findings — they came from the ndjson parser,
    // not the schema validator, but the operator wants them in the
    // same digest (one place to look).
    result.findings = [...malformed, ...result.findings];

    // ARV-311: calibrate finding severities through `.zond/severity.yaml`
    // before the rollup (severityCount) so the digest, exit code, and
    // envelope all reflect the same calibrated values.
    let severityConfig: MergedConfig | undefined;
    try {
      const ws = findWorkspaceRoot();
      severityConfig = loadSeverityConfig({ workspaceRoot: ws.root, api: options.apiName });
    } catch (err) {
      if (err instanceof SeverityConfigError) {
        const msgs = err.errors.map((e) => `${e.source}: ${e.keyPath}: ${e.message}`);
        if (options.json) printJson(jsonError("probe-webhooks", msgs));
        else for (const m of msgs) printError(m);
        return 2;
      }
      throw err;
    }
    calibrateWebhookFindings(result.findings, severityConfig);

    const sev = severityCount(result.findings);
    const fmt: "markdown" | "json" = options.report ?? "markdown";

    if (options.output) {
      const payload = fmt === "json"
        ? JSON.stringify({ event_log: options.eventLog, ...result }, null, 2) + "\n"
        : formatMarkdown(spec, result, options.eventLog);
      await writeFile(options.output, payload, "utf-8");
    }

    if (options.json) {
      printJson(jsonOk("probe-webhooks", {
        event_log: options.eventLog,
        total_events: result.total_events,
        declared_events: result.declared_events,
        by_type: result.by_type,
        summary: { high: sev.high, low: sev.low, total: result.findings.length },
        skip_reason: result.skip_reason,
        findings: result.findings,
      }));
    } else if (!options.output) {
      if (fmt === "json") {
        process.stdout.write(JSON.stringify({ event_log: options.eventLog, ...result }, null, 2) + "\n");
      } else {
        process.stdout.write(formatMarkdown(spec, result, options.eventLog));
      }
    } else {
      printSuccess(`${fmt === "json" ? "Structured report" : "Digest"} written to ${options.output}`);
    }

    if (!options.json && sev.high > 0) {
      printWarning(`${sev.high} HIGH-severity finding(s) — webhook payloads drift from declared schema.`);
    }
    return sev.high > 0 ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) printJson(jsonError("probe-webhooks", [message]));
    else printError(message);
    return 2;
  }
}

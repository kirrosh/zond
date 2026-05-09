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
import type { Command } from "commander";

import { listChecks, runChecks } from "../../core/checks/index.ts";
import { resolveSpecArg, globalJson, resolveApiCollection } from "../resolve.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { printError, printSuccess } from "../output.ts";
import { loadEnvironment } from "../../core/parser/variables.ts";

interface ChecksListOptions {
  json?: boolean;
}

async function checksListAction(_args: unknown, cmd: Command): Promise<void> {
  const opts = cmd.opts<ChecksListOptions>();
  const json = opts.json === true || globalJson(cmd);
  const catalog = listChecks().map((c) => ({
    id: c.id,
    severity: c.severity,
    default_expected: c.defaultExpected,
    references: c.references,
  }));

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
  if (!apiName) {
    return { error: "Need --base-url <url> (or --api <name> with base_url in apis/<name>/.env.yaml)" };
  }
  const col = resolveApiCollection(apiName, dbPath);
  if ("error" in col) return col;
  if (!col.baseDir) {
    return { error: `API '${apiName}' has no base_dir registered — pass --base-url <url>` };
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

  const specRes = resolveSpecArg(opts.spec, opts.api ?? cmd.parent?.opts().api, opts.db);
  if ("error" in specRes) {
    if (json) printJson(jsonError("checks run", [specRes.error]));
    else printError(specRes.error);
    process.exit(2);
  }

  const baseRes = await resolveBaseUrl(opts.api ?? cmd.parent?.opts().api, opts.baseUrl, opts.db);
  if ("error" in baseRes) {
    if (json) printJson(jsonError("checks run", [baseRes.error]));
    else printError(baseRes.error);
    process.exit(2);
  }

  try {
    const result = await runChecks({
      specPath: specRes.spec,
      baseUrl: baseRes.baseUrl,
      include: splitList(opts.check),
      exclude: splitList(opts.excludeCheck),
      timeoutMs: typeof opts.timeout === "number" ? opts.timeout : undefined,
    });
    const warnings: string[] = [];
    for (const id of result.selection.unknown) {
      warnings.push(`Unknown check: "${id}" — ignored. Run \`zond checks list\` to see registered ids.`);
    }
    if (json) {
      printJson(jsonOk("checks run", result.data, warnings.length > 0 ? warnings : undefined));
    } else {
      for (const w of warnings) console.error(w);
      const s = result.data.summary;
      printSuccess(
        `${s.findings} finding(s) across ${s.cases} case(s) on ${s.operations} operation(s) — ${s.checks_run} check(s) active`,
      );
      for (const f of result.data.findings) {
        console.log(`  [${f.severity}] ${f.check} ${f.operation.method} ${f.operation.path} — ${f.message}`);
      }
    }
    // Exit-code rule: 0 when no HIGH/CRITICAL findings, 1 otherwise. LOW/MEDIUM
    // findings are reported but don't gate CI by default — agents that want
    // strict gating can post-process the JSON envelope.
    process.exit(result.high_or_critical > 0 ? 1 : 0);
  } catch (err) {
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
    .action(checksRunAction);
}

export function registerChecks(program: Command): void {
  const cmd = program
    .command("checks")
    .description("Run schemathesis-style conformance/security checks against an API");
  defineList(cmd);
  defineRun(cmd);
}

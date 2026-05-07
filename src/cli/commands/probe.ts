/**
 * Probe umbrella + back-compat aliases.
 *
 * TASK-182 (m-11) introduced `zond probe <class>` as the canonical way to
 * run validation / methods / mass-assignment / security probes. The four
 * standalone top-level probe-* names are kept as deprecated aliases for
 * one release with a stderr warning.
 *
 * Extracted from program.ts (TASK-190 round 2e) so the registration tree
 * lives next to the action functions it dispatches into.
 */

import type { Command } from "commander";

import { probeValidationCommand } from "./probe-validation.ts";
import { probeMethodsCommand } from "./probe-methods.ts";
import { probeMassAssignmentCommand } from "./probe-mass-assignment.ts";
import { probeSecurityCommand } from "./probe-security.ts";
import { globalJson, resolveSpecArg, warnDeprecatedProbe } from "../resolve.ts";
import { parsePositiveInt } from "../argv.ts";
import { printError } from "../output.ts";

function defineProbeValidation(parent: Command, name: string, deprecated: boolean): void {
  parent
    .command(`${name} [spec]`)
    .description("Generate negative-input probe suites (catches 5xx-on-bad-input bugs)")
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .requiredOption("--output <dir>", "Output directory for generated probe files")
    .option("--tag <tag>", "Probe only endpoints with this tag")
    .option("--list-tags", "List available tags from spec and exit")
    .option("--max-per-endpoint <N>", "Cap probes per endpoint (default 50)", parsePositiveInt("--max-per-endpoint"))
    .option("--no-cleanup", "Skip emission of follow-up DELETE cleanup steps for mutating probes (use in namespace-isolated test envs)")
    .option("--no-real-parents", "Bake synthetic-by-type values into all path params (legacy). By default, non-attacked path params are emitted as {{name}} and resolved from .env.yaml at run time — needed to reach the leaf validator on nested paths (TASK-135).")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      if (deprecated) warnDeprecatedProbe("probe-validation", "validation");
      const resolved = resolveSpecArg(specPos, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      process.exitCode = await probeValidationCommand({
        specPath: resolved.spec,
        output: opts.output,
        tag: opts.tag,
        maxPerEndpoint: opts.maxPerEndpoint,
        noCleanup: opts.cleanup === false,
        useRealParents: opts.realParents !== false,
        json: globalJson(cmd),
        listTags: opts.listTags,
      });
    });
}

function defineProbeMassAssignment(parent: Command, name: string, deprecated: boolean): void {
  parent
    .command(`${name} [spec]`)
    .description(
      "Live probe for mass-assignment / privilege-escalation: classifies POST/PATCH/PUT against suspected extra fields (is_admin, role, account_id, owner_id, user_id, verified, is_system) as rejected (4xx) | accepted-and-applied (HIGH) | accepted-and-ignored (LOW) via follow-up GET",
    )
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .requiredOption("--env <file>", "Env YAML with base_url + auth_token (live calls require this)")
    .option("--output <file>", "Write markdown digest to file (default: stdout)")
    .option("--emit-tests <dir>", "Also emit YAML regression suites locking in safe behaviour for CI")
    .option("--tag <tag>", "Probe only endpoints with this tag")
    .option("--list-tags", "List available tags from spec and exit")
    .option("--no-cleanup", "Skip follow-up DELETE for resources accidentally created by 2xx probes")
    .option("--no-discover", "Disable auto-discovery of path-param fixtures via GET-on-list (TASK-92)")
    .option("--timeout <ms>", "Per-request timeout in ms (default 30000)", parsePositiveInt("--timeout"))
    .option("--overwrite", "Overwrite existing --output file in place (default: rotate to <stem>-vN.<ext>)")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      if (deprecated) warnDeprecatedProbe("probe-mass-assignment", "mass-assignment");
      const resolved = resolveSpecArg(specPos, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      process.exitCode = await probeMassAssignmentCommand({
        specPath: resolved.spec,
        env: opts.env,
        output: opts.output,
        emitTests: opts.emitTests,
        tag: opts.tag,
        listTags: opts.listTags,
        noCleanup: opts.cleanup === false,
        noDiscover: opts.discover === false,
        timeoutMs: opts.timeout,
        overwrite: opts.overwrite === true,
        json: globalJson(cmd),
      });
    });
}

function defineProbeSecurity(parent: Command, name: string, deprecated: boolean): void {
  parent
    .command(`${name} <classes> [spec]`)
    .description(
      "Live security probes (TASK-138): SSRF / CRLF / open-redirect. Detects vulnerable fields by name+format, sends a baseline-OK then per-field payloads, classifies HIGH (5xx or echo) / LOW (2xx no echo) / OK (4xx). <classes> is a comma-separated subset of: ssrf, crlf, open-redirect.",
    )
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--env <file>", "Env YAML with base_url + auth_token (live calls require this; --dry-run can run without)")
    .option("--output <file>", "Write markdown digest to file (default: stdout)")
    .option("--emit-tests <dir>", "Also emit YAML regression suites locking in safe behaviour for CI")
    .option("--tag <tag>", "Probe only endpoints with this tag")
    .option("--list-tags", "List available tags from spec and exit")
    .option("--no-cleanup", "Skip follow-up DELETE on resources created by baseline / 2xx attacks")
    .option("--dry-run", "Print which endpoints/fields would be attacked without sending requests")
    .option("--timeout <ms>", "Per-request timeout in ms (default 30000)", parsePositiveInt("--timeout"))
    .option("--overwrite", "Overwrite existing --output file in place (default: rotate to <stem>-vN.<ext>)")
    .action(async (classes: string, specPos: string | undefined, opts, cmd: Command) => {
      if (deprecated) warnDeprecatedProbe("probe-security", "security");
      const resolved = resolveSpecArg(specPos, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      process.exitCode = await probeSecurityCommand({
        specPath: resolved.spec,
        classes,
        env: opts.env,
        output: opts.output,
        emitTests: opts.emitTests,
        tag: opts.tag,
        listTags: opts.listTags,
        noCleanup: opts.cleanup === false,
        dryRun: opts.dryRun === true,
        timeoutMs: opts.timeout,
        overwrite: opts.overwrite === true,
        json: globalJson(cmd),
      });
    });
}

function defineProbeMethods(parent: Command, name: string, deprecated: boolean): void {
  parent
    .command(`${name} [spec]`)
    .description("Generate negative-method probe suites (catches 5xx/2xx on undeclared HTTP methods)")
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .requiredOption("--output <dir>", "Output directory for generated probe files")
    .option("--tag <tag>", "Probe only endpoints with this tag")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      if (deprecated) warnDeprecatedProbe("probe-methods", "methods");
      const resolved = resolveSpecArg(specPos, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      process.exitCode = await probeMethodsCommand({
        specPath: resolved.spec,
        output: opts.output,
        tag: opts.tag,
        json: globalJson(cmd),
      });
    });
}

export function registerProbes(program: Command): void {
  const probeCmd = program
    .command("probe")
    .description("Run a probe class — pick one of: validation, methods, mass-assignment, security");
  defineProbeValidation(probeCmd, "validation", false);
  defineProbeMethods(probeCmd, "methods", false);
  defineProbeMassAssignment(probeCmd, "mass-assignment", false);
  defineProbeSecurity(probeCmd, "security", false);

  // Deprecated top-level aliases — preserve the original registration order
  // (validation, mass-assignment, security inserted before lint-spec, then
  // methods after lint-spec) so help output stays byte-identical.
}

export function registerProbeAliasesEarly(program: Command): void {
  defineProbeValidation(program, "probe-validation", true);
  defineProbeMassAssignment(program, "probe-mass-assignment", true);
  defineProbeSecurity(program, "probe-security", true);
}

export function registerProbeMethodsAlias(program: Command): void {
  defineProbeMethods(program, "probe-methods", true);
}

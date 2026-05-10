/**
 * Probe contract (m-17 / ARV-49).
 *
 * `zond probe <class>` originally grew as three independent commands —
 * static, mass-assignment, security — that ad-hoc-агree on flags and
 * output shape. The agent-readable contract started drifting (security
 * has --dry-run, mass-assignment doesn't; security --json packages
 * markdown into `data.digest.stdout`, run --report json returns
 * structured per-endpoint findings; ARV-9 AC#6 deferred --include/--exclude
 * for the probe family). m-17 raises this from "convention" to
 * "TS-interface validated at boot".
 *
 * `Probe` is the contract every registered probe class MUST satisfy.
 * `commonFlags` is a declarative slot table — the harness uses it both
 * for boot-validation (registry refuses to start if a slot is missing)
 * and for help/feature-detection. dry-run and run return DIFFERENT
 * shapes on purpose (ARV-50): dry-run answers "what would I attack",
 * run answers "what did I find". Severity is undefined in dry-run.
 */
import type { EndpointInfo, SecuritySchemeInfo } from "../generator/types.ts";

/**
 * Common-flag manifest. Boot-validator checks each registered probe
 * declares every slot — `true` means "this probe's CLI exposes the
 * flag", `false` means "intentionally not supported". We don't allow
 * undefined: forcing a boolean makes "we forgot to wire it" obvious in
 * code review (ARV-9 AC#6, F2-15).
 */
export interface ProbeFlags {
  /** `--api <name>` */
  api: boolean;
  /** `--tag <tag>` */
  tag: boolean;
  /** Repeatable `--include <selector:value>` (m-15 ARV-9 grammar). */
  include: boolean;
  /** Repeatable `--exclude <selector:value>`. */
  exclude: boolean;
  /** `--dry-run` — list planned attacks without sending requests. */
  dryRun: boolean;
  /** `--list-tags` — print spec tags and exit. */
  listTags: boolean;
  /** `--json` — emit single JSON envelope on stdout. */
  json: boolean;
  /** `--output <file>` — write markdown / SARIF digest to file. */
  output: boolean;
  /** `--report <markdown|json|sarif>` — choose the structured report
   *  format (m-17 ARV-51). */
  report: boolean;
}

/**
 * Per-endpoint dry-run record. Returned from `Probe.dryRun()`. Severity
 * is intentionally absent: nothing has been classified yet (ARV-50).
 *
 * `planned: true` means the probe would send live traffic at this
 * endpoint; `planned: false` + `skip_reason` means we identified the
 * endpoint but won't probe it (no body, isolated path-param, …).
 */
export interface EndpointPlan {
  path: string;
  method: string;
  planned: boolean;
  /** Probe-class IDs we'd run (e.g. ["ssrf","crlf"] or ["mass-assignment"]). */
  classes_planned: string[];
  /** Suspect fields the probe would touch (mass-assignment / security only). */
  fields_planned: string[];
  /** Null when planned, populated when planned:false. Closed string set
   *  per-probe (security: 'no-body'|'no-matched-field'|'isolated-protected'|
   *  'unresolved-path'; mass-assignment: 'no-body'|'isolated-protected'). */
  skip_reason: string | null;
}

/**
 * Severity classifier outcome for a finding. `inconclusive` covers both
 * baseline-failure and 5xx-on-attack — sub-classes carry the detail in
 * `evidence`. Mirrors the existing union in security-probe.ts so we
 * don't double-up on enums.
 */
export type ProbeFindingSeverity =
  | "high"
  | "low"
  | "inconclusive"
  | "ok";

export interface ProbeFinding {
  /** Probe-class id (e.g. "ssrf", "open-redirect", "mass-assignment"). */
  class: string;
  severity: ProbeFindingSeverity;
  /** Free-form evidence: request signature, response signature, baseline
   *  diff, etc. Schema is per-probe, but stays structured (no markdown). */
  evidence: Record<string, unknown>;
}

export type ProbeEndpointStatus = "ok" | "high" | "low" | "inconclusive" | "skipped";

export interface ProbeEndpointResult {
  path: string;
  method: string;
  /** Probe classes that actually ran on this endpoint. */
  classes_run: string[];
  findings: ProbeFinding[];
  status: ProbeEndpointStatus;
  skip_reason?: string;
}

export interface ProbeRunSummary {
  totalEndpoints: number;
  probed: number;
  /** Per-status tally; identical to existing severity buckets, but with
   *  closed shape (ARV-51). */
  by_status: Record<ProbeEndpointStatus, number>;
}

/**
 * Result of a live `Probe.run()`. `endpoints[]` is the agent-routable
 * structure; markdown digest is rendered separately by `Probe.report()`.
 */
export interface ProbeResult {
  endpoints: ProbeEndpointResult[];
  summary: ProbeRunSummary;
  warnings: string[];
  /** Optional probe-specific extras (e.g. orphans, emittedTests) that
   *  don't fit the per-endpoint shape but agents still need access to. */
  extras?: Record<string, unknown>;
}

export type ProbeReportFormat = "markdown" | "json";

export interface ProbeContext {
  specPath: string;
  /** Pre-loaded endpoints (probe harness loads spec once and shares). */
  endpoints: EndpointInfo[];
  securitySchemes: SecuritySchemeInfo[];
  /** Resolved env vars (`base_url`, `auth_token`, fixture vars). Empty
   *  for dry-run when the env file is absent. */
  vars: Record<string, string>;
  /** Selector strings (m-15 ARV-9 grammar: `path:`, `method:`, `tag:`,
   *  `operation-id:`). Pre-applied to `endpoints` before this context
   *  reaches the probe. Carried for diagnostics. */
  filter?: { includes: string[]; excludes: string[] };
  /** Probe-class subset (e.g. for security: ["ssrf","crlf"]). */
  classes?: string[];
  /** Probe-specific options bag — kept opaque so the harness doesn't
   *  need to know each probe's flag inventory. */
  options: Record<string, unknown>;
}

/**
 * The contract. Every registered probe MUST implement all four
 * required methods; missing one trips boot-validation in
 * `registry.ts`. listTags is optional — most probes share the same
 * loadSpecForProbe shortcut via the harness, so we don't force it.
 */
export interface Probe {
  readonly name: string;
  readonly description: string;
  readonly commonFlags: ProbeFlags;
  /** List endpoints + classes the probe would attack (no live traffic). */
  dryRun(ctx: ProbeContext): Promise<EndpointPlan[]>;
  /** Run the probe live and return structured per-endpoint findings. */
  run(ctx: ProbeContext): Promise<ProbeResult>;
  /** Render a structured (json) or human (markdown) digest. */
  report(format: ProbeReportFormat, result: ProbeResult): string | object;
}

/**
 * Convenience base class. Subclasses implement abstract slots; we keep
 * the shape minimal so boot-validation still catches missing methods
 * (the abstract declarations are purely a TypeScript hint, not the
 * runtime check).
 */
export abstract class BaseProbe implements Probe {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly commonFlags: ProbeFlags;
  abstract dryRun(ctx: ProbeContext): Promise<EndpointPlan[]>;
  abstract run(ctx: ProbeContext): Promise<ProbeResult>;
  abstract report(format: ProbeReportFormat, result: ProbeResult): string | object;
}

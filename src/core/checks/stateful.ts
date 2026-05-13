/**
 * Stateful checks (m-15 ARV-3) — security-flavored checks that need
 * to orchestrate multiple HTTP requests against a single operation
 * (auth probes) or a CRUD chain (use-after-free / availability).
 *
 * Kept in a parallel registry from the per-response `Check`s so the
 * single-response runner stays simple. `runChecks` calls
 * `runStateful(...)` after the per-op response phase.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { CrudGroup, EndpointInfo } from "../generator/types.ts";
import type { HttpRequest, HttpResponse } from "../runner/types.ts";
import { executeRequest } from "../runner/http-client.ts";
import type { CheckOutcome, CheckReference, CheckRuntimeOptions, Severity } from "./types.ts";

export interface StatefulHarness {
  baseUrl: string;
  doc: OpenAPIV3.Document;
  /** Headers that constitute "real auth" for the run. Empty when the
   *  caller didn't pass --auth-header / no env vars. */
  authHeaders: Record<string, string>;
  /** When true, security checks should skip with a warning (ARV-3 AC #6). */
  bootstrapCleanupFailed: boolean;
  /** ARV-181: real path-param fixtures from `.env.yaml`. Mirrors what
   *  the per-response runner already does via ARV-141 — without this
   *  the stateful harness rebuilds URLs with literal `{event_id}`
   *  placeholders, gets routed to 403/404, and the broken-baseline
   *  guard silently skips real auth checks. Optional so unit tests
   *  can stub without it; production callers always pass them. */
  pathVars?: Record<string, string>;
  /** ARV-181: per-run knobs (e.g. strict401). Mirrors CheckContext.options
   *  for stateful checks so they can read the same flags as per-response
   *  ones. */
  options?: CheckRuntimeOptions;
  /** ARV-169 (m-20): per-resource overrides for cross-call probes,
   *  keyed by `resource` name from `.api-resources.yaml`. Today only
   *  `cross_call_references` reads `readbackDiff`; future m-20 probes
   *  (idempotency, pagination, lifecycle) will append their own keys
   *  to the per-resource entry. Optional — when absent each probe
   *  falls back to its built-in defaults. */
  resourceConfigs?: Map<string, {
    readbackDiff?: import("../generator/resources-builder.ts").ReadbackDiffConfig;
    idempotency?: import("../generator/resources-builder.ts").IdempotencyConfig;
  }>;
  send(req: HttpRequest, opts?: { timeoutMs?: number }): Promise<HttpResponse>;
}

export interface BaseStatefulCheck {
  id: string;
  severity: Severity;
  defaultExpected: string;
  references: CheckReference[];
}

export interface AuthStatefulCheck extends BaseStatefulCheck {
  phase: "auth";
  applies(op: EndpointInfo): boolean;
  run(op: EndpointInfo, h: StatefulHarness): Promise<CheckOutcome>;
}

export interface CrudStatefulCheck extends BaseStatefulCheck {
  phase: "crud";
  applies(group: CrudGroup): boolean;
  run(group: CrudGroup, h: StatefulHarness): Promise<CheckOutcome>;
}

export type StatefulCheck = AuthStatefulCheck | CrudStatefulCheck;

const STATEFUL_REGISTRY = new Map<string, StatefulCheck>();

export function registerStatefulCheck(c: StatefulCheck): void {
  if (STATEFUL_REGISTRY.has(c.id)) throw new Error(`Stateful check "${c.id}" already registered`);
  STATEFUL_REGISTRY.set(c.id, c);
}

export function listStatefulChecks(): StatefulCheck[] {
  return [...STATEFUL_REGISTRY.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function makeHarness(
  baseUrl: string,
  doc: OpenAPIV3.Document,
  opts: {
    authHeaders?: Record<string, string>;
    bootstrapCleanupFailed?: boolean;
    timeoutMs?: number;
    pathVars?: Record<string, string>;
    options?: CheckRuntimeOptions;
    resourceConfigs?: StatefulHarness["resourceConfigs"];
  } = {},
): StatefulHarness {
  return {
    baseUrl,
    doc,
    authHeaders: opts.authHeaders ?? {},
    bootstrapCleanupFailed: opts.bootstrapCleanupFailed ?? false,
    pathVars: opts.pathVars,
    options: opts.options,
    resourceConfigs: opts.resourceConfigs,
    send: (req, sendOpts) => executeRequest(req, { timeout: sendOpts?.timeoutMs ?? opts.timeoutMs ?? 30000 }),
  };
}

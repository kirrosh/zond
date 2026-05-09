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
import type { CheckOutcome, CheckReference, Severity } from "./types.ts";

export interface StatefulHarness {
  baseUrl: string;
  doc: OpenAPIV3.Document;
  /** Headers that constitute "real auth" for the run. Empty when the
   *  caller didn't pass --auth-header / no env vars. */
  authHeaders: Record<string, string>;
  /** When true, security checks should skip with a warning (ARV-3 AC #6). */
  bootstrapCleanupFailed: boolean;
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

export function getStatefulCheck(id: string): StatefulCheck | undefined {
  return STATEFUL_REGISTRY.get(id);
}

export function __resetStatefulRegistryForTests(): void {
  STATEFUL_REGISTRY.clear();
}

export function makeHarness(
  baseUrl: string,
  doc: OpenAPIV3.Document,
  opts: { authHeaders?: Record<string, string>; bootstrapCleanupFailed?: boolean; timeoutMs?: number } = {},
): StatefulHarness {
  return {
    baseUrl,
    doc,
    authHeaders: opts.authHeaders ?? {},
    bootstrapCleanupFailed: opts.bootstrapCleanupFailed ?? false,
    send: (req, sendOpts) => executeRequest(req, { timeout: sendOpts?.timeoutMs ?? opts.timeoutMs ?? 30000 }),
  };
}

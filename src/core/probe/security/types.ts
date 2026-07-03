import type { EndpointInfo, SecuritySchemeInfo } from "../../generator/types.ts";
import type { SeedBodyConfig } from "../../generator/resources-builder.ts";
import type { RecommendedAction } from "../../diagnostics/failure-hints.ts";

export type SecurityClass = "ssrf" | "crlf" | "open-redirect";

export const SECURITY_CLASSES: SecurityClass[] = ["ssrf", "crlf", "open-redirect"];

/**
 * Security-probe severity ladder. Includes 'info' (ARV-253) for
 * sanitization-only signals (CRLF accept-without-reflection) and
 * 'medium' (ARV-254) for SSRF accept on endpoints declaring delivery
 * semantics. The full m-21 matrix governs the cap: HIGH requires
 * evidence_chain proof, OOB-backed SSRF lands here only when ARV-177
 * lifts.
 */
export type SecuritySeverity =
  | "high"
  | "medium"
  | "low"
  | "info"
  | "inconclusive"
  | "inconclusive-baseline"
  | "ok"
  | "skipped";

export interface SecurityFieldHit {
  /** Field name in the request body. */
  field: string;
  /** Class that triggered (a field can hit multiple — we record all). */
  class: SecurityClass;
}

export interface SecurityFinding {
  field: string;
  class: SecurityClass;
  payload: string;
  /** Raw HTTP status of the attack request. */
  status: number;
  /** Whether the response body echoes the payload (suggesting stored injection). */
  echoed: boolean;
  /** PASS / FAIL classification per finding. */
  severity: SecuritySeverity;
  reason: string;
  /** TASK-294: agent-routable action. FAIL/WARN → `report_backend_bug`;
   *  PASS → undefined (no action needed). */
  recommended_action?: RecommendedAction;
  /** ARV-300: set when `.zond/severity.yaml` suppressed this finding
   *  (severity forced to `info`). Preserves the audit-trail so ndjson/JSON
   *  consumers can tell a suppressed finding from a naturally-INFO one. */
  suppressed_by?: { source: string; rule_index: number; reason: string };
}

export interface SecurityVerdict {
  method: string;
  path: string;
  /** Most-severe finding wins. */
  severity: SecuritySeverity;
  summary: string;
  /** Field hits detected on this endpoint (some may have produced no findings). */
  detectedFields: SecurityFieldHit[];
  /** All attempted attacks. Empty for SKIPPED endpoints. */
  findings: SecurityFinding[];
  baseline?: { status: number };
  cleanup?: {
    attempted: boolean;
    status?: number;
    error?: string;
    /** TASK-278: created resource id (slug/uuid/...) so `zond cleanup --orphans`
     *  can retry DELETE without re-running the probe. */
    id?: string | number;
    /** TASK-278: concrete DELETE URL path with the id substituted. */
    deletePath?: string;
  };
  skipReason?: string;
}

export interface SecurityProbeOptions {
  endpoints: EndpointInfo[];
  securitySchemes: SecuritySchemeInfo[];
  vars: Record<string, string>;
  classes: SecurityClass[];
  noCleanup?: boolean;
  timeoutMs?: number;
  /** When true, only print which endpoints/fields would be attacked. */
  dryRun?: boolean;
  /**
   * DELETE-cleanup retry delays in ms (round-5: handles eventual
   * consistency between write replica and read replica). Default
   * `[200, 1000]` — two retries on 404, total worst-case ~1.2s. Tests
   * pass `[]` to disable; ops can pass longer for laggier replicas.
   */
  cleanupRetryDelaysMs?: number[];
  /** TASK-264: when true, refuse to attack PUT/PATCH/DELETE endpoints whose
   *  path-params are filled from `.env.yaml` (a.k.a. seeded fixtures). The
   *  trade-off: lower coverage (those endpoints get SKIPPED), but a
   *  guaranteed «probe doesn't mutate fixtures the user spent time
   *  bootstrapping» property. POST endpoints still run — they create their
   *  own resources, so isolation is automatic, with cleanup falling back to
   *  the existing DELETE-counterpart + orphan-tracker flow (TASK-278). */
  isolated?: boolean;
  /** ARV-140: opt-in to attacks that have no cleanup path (POSTs without a
   *  DELETE counterpart). By default we now skip them — round-01/02 Sentry
   *  runs left ~18 manually-cleanable orphans in prod because the probe
   *  happily POSTed to `/teams/`, `/symbol-sources/`, etc., where the spec
   *  has no DELETE. The pre-flight feasibility map drops these unless the
   *  caller explicitly accepts the leak. */
  allowLeaks?: boolean;
  /** ARV-269: agent-authored `seed_body` overlays from `.api-resources.local.yaml`,
   *  keyed by `"METHOD /path"`. Wins over `generateFromSchema` when the
   *  endpoint matches — see `MassAssignmentOptions.seedBodies` for the
   *  rationale (strict APIs reject random-scalar baselines). */
  seedBodies?: Map<string, SeedBodyConfig>;
}

/** ARV-140: cleanup-feasibility map. Built once before the live loop so
 *  every POST verdict can see whether the spec has a DELETE counterpart;
 *  the summary digest also reports counts for skipped/forced endpoints.
 *
 *  ARV-153 extends the status enum with "action": POSTs whose last path
 *  segment is a known action verb (`/capture`, `/verify`, `/cancel`, …)
 *  operate on an existing resource and never allocate a new one, so a
 *  DELETE counterpart isn't meaningful. These are attacked the same way
 *  as POSTs with a real DELETE — without `--allow-leaks` — because there
 *  is no resource to leak. */
export interface CleanupFeasibility {
  status: Record<string, "has-delete" | "no-delete-counterpart" | "action">;
  skippedNoCleanup: number;
  forcedNoCleanup: number;
  /** ARV-153: POSTs we attacked even though no DELETE counterpart exists,
   *  because the operation is semantically an action (no resource created). */
  actionNoCleanupNeeded: number;
}

export interface SecurityProbeResult {
  classes: SecurityClass[];
  totalEndpoints: number;
  specProbed: number;
  verdicts: SecurityVerdict[];
  warnings: string[];
  /** ARV-140: cleanup-feasibility digest (POSTs without DELETE counterpart). */
  cleanupFeasibility?: CleanupFeasibility;
}

/** Internal: per-step options shared between orchestrator/baseline/cleanup. */
export interface ProbeStepOpts {
  noCleanup: boolean;
  timeoutMs?: number;
  cleanupRetryDelaysMs?: number[];
  /** ARV-269: optional `seed_body` overlay for this endpoint. */
  seedBody?: SeedBodyConfig;
}

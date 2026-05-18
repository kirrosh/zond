import type { EndpointInfo, SecuritySchemeInfo } from "../../generator/types.ts";
import type { SeedBodyConfig } from "../../generator/resources-builder.ts";
import type { RecommendedAction } from "../../diagnostics/failure-hints.ts";

/**
 * Mass-assignment local severity. Includes the unified severity ladder
 * (critical/high/medium/low/info — see core/severity) plus two
 * outcome-style states specific to this probe (inconclusive-baseline,
 * inconclusive-5xx) and probe-lifecycle markers (ok, skipped).
 *
 * 'medium' is retained in the type for backwards compat but ARV-250
 * stopped emitting it — single-signal proof on absent-fields now caps
 * to 'low' per the m-21 severity matrix.
 */
export type Severity =
  | "high"
  | "medium"
  /** Baseline POST itself failed — we never reached extras-validation, so the
   *  4xx-with-extras was a false signal. User must fix fixture / FK / scope
   *  before this endpoint can be probed (TASK-91). */
  | "inconclusive-baseline"
  /** Baseline POST returned ≥500 — the endpoint just crashes, mass-assignment
   *  semantics aren't observable here. Likely a duplicate of validation-probe's
   *  finding for the same endpoint (TASK-276). */
  | "inconclusive-5xx"
  | "low"
  | "info"
  | "ok"
  | "skipped";

export interface FieldVerdict {
  field: string;
  injected: unknown;
  /** "applied" | "ignored" | "echoed-but-overwritten" | "absent" | "unknown" */
  outcome: "applied" | "ignored" | "echoed-overwritten" | "absent" | "unknown";
  /** Value as seen in the response body (or follow-up GET if applicable). */
  observed?: unknown;
}

export interface EndpointVerdict {
  method: string;
  path: string;
  severity: Severity;
  /** Canonical short reason (used in markdown header). */
  summary: string;
  request: {
    url: string;
    body: unknown;
    injectedFields: string[];
  };
  response?: {
    status: number;
    body?: unknown;
  };
  followUpGet?: {
    url: string;
    status: number;
    body?: unknown;
  };
  /** Result of the baseline (no-extras) probe — present whenever we sent it
   *  (always, except for skipped endpoints). Used to disambiguate
   *  «extras refused» from «baseline body invalid» (TASK-91). */
  baseline?: {
    status: number;
    body?: unknown;
  };
  fields: FieldVerdict[];
  /** True when request schema has additionalProperties:false (strict). */
  strictContract: boolean;
  cleanup?: {
    attempted: boolean;
    status?: number;
    error?: string;
  };
  /** Reason this endpoint was skipped (only set when severity === "skipped"). */
  skipReason?: string;
  notes?: string[];
  /** TASK-294: agent-routable action.
   *  high/medium → `report_backend_bug` (privilege escalation).
   *  inconclusive-baseline → `fix_fixture` (broken request body, retry).
   *  inconclusive-5xx → `report_backend_bug` (server crashed).
   *  low/ok/skipped → undefined. */
  recommended_action?: RecommendedAction;
}

export interface MassAssignmentOptions {
  endpoints: EndpointInfo[];
  securitySchemes: SecuritySchemeInfo[];
  /** Substituted variables (base_url, auth_token, api_key, path params). */
  vars: Record<string, string>;
  /** When true, do not issue cleanup-DELETE after 2xx responses. */
  noCleanup?: boolean;
  /** Per-request fetch timeout (ms). */
  timeoutMs?: number;
  /** When false, skip auto-discovery of path-param fixtures via GET-on-list (TASK-92).
   *  TASK-137: this flag now also controls body-FK discovery (required body
   *  fields named `*_id` / `*_slug` / `*_uuid` get filled from the matching
   *  collection list endpoint, eliminating most INCONCLUSIVE-baseline noise). */
  discover?: boolean;
  /** ARV-252: per-run extension to SUSPECTED_FIELDS (curated list of
   *  classic mass-assignment vectors). CLI surfaces this as repeatable
   *  `--suspect-field name=value`. Full per-api spec-extension support
   *  (x-zond-suspect-fields) is tracked in ARV-189. */
  extraSuspectFields?: Record<string, unknown>;
  /** ARV-269: agent-authored `seed_body` overlays from `.api-resources.local.yaml`,
   *  keyed by `"METHOD /path"` of the endpoint they apply to (typically the
   *  resource's create endpoint). When present for a probed endpoint, it
   *  replaces `generateFromSchema` as the baseline body source — same
   *  promotion stateful checks took via `resolveCreateBody`. Mass-assignment
   *  before ARV-269 ignored this overlay; on strict-validating APIs (Stripe)
   *  every baseline 400'd and the verdict collapsed to INCONCLUSIVE. */
  seedBodies?: Map<string, SeedBodyConfig>;
}

export interface MassAssignmentResult {
  specProbed: number;
  totalEndpoints: number;
  verdicts: EndpointVerdict[];
  warnings: string[];
}

/** Internal: per-step options for probeEndpoint. */
export interface ProbeEndpointOpts {
  noCleanup: boolean;
  timeoutMs?: number;
  bodyFkMisses?: Array<{ field: string; reason: string }>;
  /** TASK-137: field→value pairs from body-FK discovery. Overlaid on baseline
   *  after generation so a real id/slug replaces the random sentinel. */
  bodyFkOverlay?: Record<string, string>;
  /** ARV-252: per-run extras for the suspect-fields list. */
  extraSuspectFields?: Record<string, unknown>;
  /** ARV-269: optional agent-authored body overlay for this endpoint
   *  (usually the resource's create endpoint). Wins over generator. */
  seedBody?: SeedBodyConfig;
}

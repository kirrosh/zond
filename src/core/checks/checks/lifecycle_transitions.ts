/**
 * `lifecycle_transitions` (m-20 ARV-172, ARV-219 added observation in m-21)
 * — verify a resource's declared state machine on the live API.
 *
 * Two modes, gated on the `actions` field of the yaml manifest:
 *
 *  ── Action-driven mode (preferred when CRUD allows mutation) ───────
 *   Requires `g.create && g.read`. For each declared `action`:
 *     1. POST create → capture id + initial state.
 *     2. Assert initial state ∈ declared `states[]`.
 *     3. For each action in object-key order:
 *        a. POST <action.endpoint> with {id} substituted.
 *        b. GET resource → read `state.field`.
 *        c. Assert observed state == `action.expected_state` and the
 *           (previous, observed) hop is in `transitions`.
 *        d. POST action a second time (idempotency probe); state must
 *           not regress.
 *
 *  ── Pure-observation mode (ARV-219, for read-only state machines) ──
 *   Triggers when `actions: {}` (or omitted). Requires `g.list`.
 *   GET list once, walk items, collect any state values not in
 *   `states[]`. Surfaces a single finding listing each undeclared
 *   state with sample item ids. Useful for APIs where zond cannot
 *   POST (read-only PAT, GitHub Issues without write scope, …) but
 *   the spec still declares a status enum — drift between observed
 *   and declared states is a contract-doc bug.
 *
 * Severity: HIGH. Failure classes share one finding (consistent with
 * cross_call_references / idempotency_replay / pagination_invariants);
 * evidence.kind discriminates.
 *
 * Anti-FP guards (both modes):
 *   • Yaml manifest validated at load (validateLifecycleManifest in
 *     resources-builder); a malformed manifest skips with the
 *     concrete error so the operator gets actionable feedback.
 *   • Non-2xx baseline (create or list) → broken-baseline skip.
 *   • Action POST non-2xx on first call → action-not-supported skip
 *     (the API may have authoritative server-side gating; not a
 *     contract bug).
 *   • Pure-observation: empty list response → skip (no data to
 *     observe), not a finding.
 *
 * Limitations:
 *   • Pure-observation cannot verify `transitions[]` — there is no
 *     time series in a single list call. The check only enforces
 *     `observed ⊆ declared`; the transition graph is purely
 *     documentation in observation mode.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { CrudStatefulCheck } from "../stateful.ts";
import type { LifecycleConfig, LifecycleAction } from "../../generator/resources-builder.ts";
import { validateLifecycleManifest } from "../../generator/resources-builder.ts";
import {
  extractIdFromCreateResponse,
  fillPathWithId,
  fillPathParams,
  serializeCheckBody,
  resolveCreateBody,
} from "./_crud-helpers.ts";

function safeParse(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
}

function readState(body: unknown, field: string): string | null {
  if (!body || typeof body !== "object") return null;
  const v = (body as Record<string, unknown>)[field];
  return typeof v === "string" ? v : null;
}

function parseEndpointLabel(label: string): { method: string; path: string } | null {
  const parts = label.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return { method: parts[0]!.toUpperCase(), path: parts[1]! };
}

function transitionAllowed(cfg: LifecycleConfig, from: string, to: string): boolean {
  // Same-state replay is always OK (idempotent action).
  if (from === to) return true;
  for (const t of cfg.transitions) {
    if (t.from === from && t.to.includes(to)) return true;
  }
  return false;
}

interface Finding {
  kind: string;
  message: string;
  extra?: Record<string, unknown>;
}

export const lifecycleTransitions: CrudStatefulCheck = {
  id: "lifecycle_transitions",
  severity: "high",
  defaultExpected: "Declared lifecycle actions must move the resource through declared states without regression",
  references: [{ id: "ARV-172" }],
  phase: "crud",
  applies(g) {
    return Boolean((g.create && g.read) || g.list);
  },
  async run(g, h) {
    if (h.bootstrapCleanupFailed) {
      return { kind: "skip", reason: "bootstrap-cleanup failed — stateful checks paused" };
    }
    const cfg = h.resourceConfigs?.get(g.resource)?.lifecycle;
    if (!cfg) return { kind: "skip", reason: "no lifecycle config for this resource" };

    const manifestErrors = validateLifecycleManifest(cfg);
    if (manifestErrors.length > 0) {
      return { kind: "skip", reason: `lifecycle manifest invalid: ${manifestErrors[0]}` };
    }

    // ARV-219: actions-empty → pure-observation mode (read-only state
    // machine). Requires a list endpoint to sample observed states.
    if (Object.keys(cfg.actions).length === 0) {
      if (!g.list) {
        return { kind: "skip", reason: "lifecycle has no actions and no list endpoint — nothing to verify or observe" };
      }
      return runPureObservation(g, h, cfg);
    }

    // Action-driven mode requires both create + read.
    if (!g.create || !g.read) {
      return { kind: "skip", reason: "lifecycle actions declared but resource lacks create+read endpoints" };
    }

    const create = g.create!;
    const read = g.read!;
    const baseHeaders = { Accept: "application/json", ...h.authHeaders };
    const stateSet = new Set(cfg.states);

    // 1. Create — prefer seed_body (ARV-187) over generator.
    const seedBody = h.resourceConfigs?.get(g.resource)?.seedBody;
    const generated = resolveCreateBody(create, seedBody) ?? {};
    const { body: createBody, contentType } = serializeCheckBody(
      create,
      generated,
      h.pathVars,
      seedBody?.contentType,
    );
    const createUrl = `${h.baseUrl.replace(/\/+$/, "")}${fillPathParams(create.path, h.pathVars)}`;
    const createResp = await h.send({
      method: "POST",
      url: createUrl,
      headers: { ...baseHeaders, "Content-Type": contentType },
      body: createBody,
    });
    if (createResp.status < 200 || createResp.status >= 300) {
      return { kind: "skip", reason: `create returned ${createResp.status} — broken-baseline guard` };
    }
    const createBodyParsed = createResp.body_parsed ?? safeParse(createResp.body);
    const id = extractIdFromCreateResponse(createBodyParsed, g.idParam);
    if (id == null) return { kind: "skip", reason: "could not extract id from create response" };

    const findings: Finding[] = [];

    let currentState = readState(createBodyParsed, cfg.field);
    if (currentState == null) {
      return { kind: "skip", reason: `state field "${cfg.field}" missing on create response — yaml mismatch or hidden field` };
    }
    if (!stateSet.has(currentState)) {
      findings.push({
        kind: "undeclared_state",
        message: `initial state "${currentState}" not in declared states [${cfg.states.join(", ")}]`,
        extra: { observed: currentState, declared: cfg.states },
      });
    }

    const readUrlFor = (resId: string | number): string =>
      `${h.baseUrl.replace(/\/+$/, "")}${fillPathWithId(fillPathParams(read.path, h.pathVars), g.idParam, resId)}`;

    // 2. For each action: invoke, read, assert.
    for (const [name, action] of Object.entries(cfg.actions) as Array<[string, LifecycleAction]>) {
      const parsed = parseEndpointLabel(action.endpoint);
      if (!parsed) {
        findings.push({
          kind: "action_endpoint_malformed",
          message: `action "${name}".endpoint "${action.endpoint}" must be "METHOD /path"`,
        });
        continue;
      }
      const actionUrl = `${h.baseUrl.replace(/\/+$/, "")}${fillPathWithId(fillPathParams(parsed.path, h.pathVars), g.idParam, id)}`;
      const actionBody = action.body
        ? serializeCheckBody(create, action.body, h.pathVars)
        : { body: "", contentType: "application/json" };
      const actionHeaders: Record<string, string> = { ...baseHeaders };
      if (action.body) actionHeaders["Content-Type"] = actionBody.contentType;

      const firstResp = await h.send({
        method: parsed.method,
        url: actionUrl,
        headers: actionHeaders,
        body: action.body ? actionBody.body : undefined,
      });
      if (firstResp.status < 200 || firstResp.status >= 300) {
        // Server-side gating; not a contract violation.
        findings.push({
          kind: "action_rejected",
          message: `action "${name}" returned ${firstResp.status} on first call — server may gate this transition`,
          extra: { action: name, status: firstResp.status },
        });
        continue;
      }

      // Read state after action.
      const readResp = await h.send({ method: "GET", url: readUrlFor(id), headers: baseHeaders });
      if (readResp.status < 200 || readResp.status >= 300) {
        findings.push({
          kind: "read_after_action_failed",
          message: `GET after action "${name}" returned ${readResp.status}`,
          extra: { action: name, read_status: readResp.status },
        });
        break;
      }
      const observedState = readState(readResp.body_parsed ?? safeParse(readResp.body), cfg.field);
      if (observedState == null) {
        findings.push({
          kind: "state_field_missing",
          message: `GET after action "${name}": state field "${cfg.field}" missing`,
          extra: { action: name },
        });
        break;
      }
      if (!stateSet.has(observedState)) {
        findings.push({
          kind: "undeclared_state",
          message: `action "${name}" produced state "${observedState}" not in declared states`,
          extra: { action: name, observed: observedState },
        });
      } else {
        if (!transitionAllowed(cfg, currentState, observedState)) {
          findings.push({
            kind: "forbidden_transition",
            message: `action "${name}": ${currentState} → ${observedState} is not allowed by declared transitions`,
            extra: { action: name, from: currentState, to: observedState },
          });
        }
        if (observedState !== action.expectedState) {
          findings.push({
            kind: "wrong_expected_state",
            message: `action "${name}": expected state "${action.expectedState}", observed "${observedState}"`,
            extra: { action: name, expected: action.expectedState, observed: observedState },
          });
        }
      }

      // 3. Idempotency probe: invoke action again, state must not regress.
      const secondResp = await h.send({
        method: parsed.method,
        url: actionUrl,
        headers: actionHeaders,
        body: action.body ? actionBody.body : undefined,
      });
      if (secondResp.status >= 500) {
        findings.push({
          kind: "double_action_5xx",
          message: `action "${name}" 5xx'd on replay (${secondResp.status}) — should be idempotent or 4xx`,
          extra: { action: name, status: secondResp.status },
        });
      } else if (secondResp.status >= 200 && secondResp.status < 300) {
        // Replay accepted — state must remain the action's expected state.
        const replayRead = await h.send({ method: "GET", url: readUrlFor(id), headers: baseHeaders });
        if (replayRead.status >= 200 && replayRead.status < 300) {
          const replayState = readState(replayRead.body_parsed ?? safeParse(replayRead.body), cfg.field);
          if (replayState != null && replayState !== observedState) {
            findings.push({
              kind: "state_regression_on_replay",
              message: `action "${name}" replay drifted state ${observedState} → ${replayState}`,
              extra: { action: name, before_replay: observedState, after_replay: replayState },
            });
          }
        }
      }
      // 4xx on replay is an acceptable "not-idempotent but safe" rejection.

      currentState = observedState;
    }

    if (findings.length === 0) return { kind: "pass" };
    const kinds = findings.map((f) => f.kind);
    const message = findings.length === 1
      ? findings[0]!.message
      : `Lifecycle on ${g.resource}: ${findings.length} issue(s) — ${kinds.join(", ")}`;
    return {
      kind: "fail",
      message,
      evidence: {
        resource: g.resource,
        id,
        kind: kinds.join("+"),
        findings: findings.map((f) => ({ kind: f.kind, message: f.message, ...(f.extra ?? {}) })),
      },
    };
  },
};

/** Item-array containers we recognise when a list endpoint returns
 *  `{ data: [...] }` etc. Mirrors `pagination_invariants` defaults so
 *  the two checks stay in sync on response-shape heuristics. */
const ITEMS_FIELD_FALLBACKS: ReadonlyArray<string> = ["data", "items", "results", "value"];

function extractListItems(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  for (const f of ITEMS_FIELD_FALLBACKS) {
    const v = obj[f];
    if (Array.isArray(v)) return v;
  }
  // ARV-219 follow-up: GitHub-shape responses use API-specific keys
  // (`workflow_runs`, `check_runs`, `artifacts`, `installations`, …)
  // alongside metadata fields like `total_count`. Pick the longest
  // array-valued property as the items collection — that's the
  // canonical shape across the GitHub REST API. Wrong-array picks
  // surface as `state field missing on all items` (informative skip),
  // never as a finding.
  let best: unknown[] | null = null;
  for (const v of Object.values(obj)) {
    if (Array.isArray(v) && (!best || v.length > best.length)) {
      best = v as unknown[];
    }
  }
  return best;
}

function pickSampleId(item: unknown, idParam: string): string | null {
  if (item == null || typeof item !== "object") return null;
  const obj = item as Record<string, unknown>;
  // Try the resource's id-param field, then a generic `id` fallback —
  // GitHub's `/issues` returns `number`, Stripe's returns `id`; both
  // serve as a human-readable sample handle in the finding evidence.
  for (const k of [idParam, "id", "number", "uuid", "key"]) {
    const v = obj[k];
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  return null;
}

async function runPureObservation(
  g: Parameters<CrudStatefulCheck["run"]>[0],
  h: Parameters<CrudStatefulCheck["run"]>[1],
  cfg: LifecycleConfig,
): ReturnType<CrudStatefulCheck["run"]> {
  const list = g.list!;
  const baseHeaders = { Accept: "application/json", ...h.authHeaders };
  const url = `${h.baseUrl.replace(/\/+$/, "")}${fillPathParams(list.path, h.pathVars)}`;

  const resp = await h.send({ method: "GET", url, headers: baseHeaders });
  if (resp.status < 200 || resp.status >= 300) {
    return { kind: "skip", reason: `list returned ${resp.status} — broken-baseline guard (observation mode)` };
  }
  const body = resp.body_parsed ?? safeParse(resp.body);
  const items = extractListItems(body);
  if (items == null) {
    return { kind: "skip", reason: "list response shape not recognised (expected array or {data|items|results|value: []})" };
  }
  if (items.length === 0) {
    return { kind: "skip", reason: "list empty — no data to observe" };
  }

  const stateSet = new Set(cfg.states);
  const missingField: string[] = [];
  // Map of undeclared state → up to N sample ids for evidence; using
  // a Map preserves observed-order so the finding mentions states
  // in the order the API surfaced them.
  const undeclared = new Map<string, string[]>();
  const SAMPLE_CAP = 5;

  for (const item of items) {
    if (item == null || typeof item !== "object") continue;
    const state = (item as Record<string, unknown>)[cfg.field];
    const sampleId = pickSampleId(item, g.idParam) ?? "?";
    if (typeof state !== "string") {
      if (missingField.length < SAMPLE_CAP) missingField.push(sampleId);
      continue;
    }
    if (!stateSet.has(state)) {
      const ids = undeclared.get(state) ?? [];
      if (ids.length < SAMPLE_CAP) ids.push(sampleId);
      undeclared.set(state, ids);
    }
  }

  // Field-missing is informational only — many APIs nest state under a
  // sub-object the operator may have misspelled. Surface as a skip when
  // EVERY item lacks the field (yaml mismatch), but don't fail the run
  // when only some items lack it (could be a polymorphic schema).
  if (undeclared.size === 0 && missingField.length === items.length) {
    return {
      kind: "skip",
      reason: `state field "${cfg.field}" missing on all ${items.length} observed items — yaml mismatch or nested field`,
    };
  }

  if (undeclared.size === 0) return { kind: "pass" };

  const observedList = [...undeclared.entries()].map(([state, ids]) => ({
    state,
    sample_ids: ids,
    occurrence_cap_hit: ids.length === SAMPLE_CAP,
  }));
  const stateNames = [...undeclared.keys()];
  return {
    kind: "fail",
    message: `Lifecycle on ${g.resource} (observation mode): observed ${undeclared.size} undeclared state(s) — ${stateNames.join(", ")}`,
    evidence: {
      resource: g.resource,
      kind: "undeclared_state",
      mode: "observation",
      observed_undeclared: observedList,
      declared_states: cfg.states,
      items_examined: items.length,
    },
  };
}

/**
 * `lifecycle_transitions` (m-20 ARV-172) — verify a resource's declared
 * state machine on the live API.
 *
 * For each CRUD group whose resource has a `lifecycle:` yaml block:
 *
 *   1. POST create → capture id + initial state from the response.
 *   2. Assert initial state ∈ declared `states[]`. Undeclared state →
 *      finding (`undeclared_state`).
 *   3. For each declared `action` in turn:
 *       a. POST <action.endpoint> with {id} substituted.
 *       b. GET resource → read `state.field`.
 *       c. Assert observed state == `action.expected_state`. Wrong
 *          terminal → finding (`wrong_expected_state`).
 *       d. Assert (previous_state, observed_state) ∈ declared
 *          transitions. Forbidden hop → finding (`forbidden_transition`).
 *       e. POST <action.endpoint> a second time (idempotency probe):
 *          either 4xx (rejected) or 2xx with state unchanged. State
 *          regression on replay → finding (`state_regression_on_replay`).
 *
 * Severity: HIGH. The four failure classes share one finding per
 * action (consistent with cross_call_references / idempotency_replay /
 * pagination_invariants). evidence.kind discriminates.
 *
 * Anti-FP guards:
 *   • Yaml manifest validated at load (validateLifecycleManifest in
 *     resources-builder); a malformed manifest skips with the
 *     concrete error so the operator gets actionable feedback.
 *   • POST create non-2xx → broken-baseline skip.
 *   • Action POST non-2xx on first call → action-not-supported skip
 *     (the API may have authoritative server-side gating; not a
 *     contract bug).
 *   • Each action runs once per check execution — actions interact in
 *     the order yaml declares them, so authoring the yaml in a
 *     legal-transition order lets the chain advance the resource.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { CrudStatefulCheck } from "../stateful.ts";
import type { LifecycleConfig, LifecycleAction } from "../../generator/resources-builder.ts";
import { validateLifecycleManifest } from "../../generator/resources-builder.ts";
import { generateFromSchema } from "../../generator/data-factory.ts";
import {
  extractIdFromCreateResponse,
  fillPathWithId,
  fillPathParams,
  serializeCheckBody,
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
    return Boolean(g.create && g.read);
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
    if (Object.keys(cfg.actions).length === 0) {
      return { kind: "skip", reason: "lifecycle has no actions to verify" };
    }

    const create = g.create!;
    const read = g.read!;
    const baseHeaders = { Accept: "application/json", ...h.authHeaders };
    const stateSet = new Set(cfg.states);

    // 1. Create
    const generated = create.requestBodySchema
      ? generateFromSchema(create.requestBodySchema)
      : {};
    const { body: createBody, contentType } = serializeCheckBody(
      create,
      (generated && typeof generated === "object" && !Array.isArray(generated))
        ? (generated as Record<string, unknown>) : {},
      h.pathVars,
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

/**
 * `pagination_invariants` (m-20 ARV-171) — cursor-style page consistency.
 *
 * For each CRUD group whose list endpoint declares a pagination block
 * (or has a recognisable cursor-style query param in the spec):
 *
 *   1. GET ?limit=N → page A.
 *   2. Pick the last item's cursor field (default `id`).
 *   3. GET ?<cursor_param>=<last_id>&limit=N → page B.
 *
 * Assertions:
 *   • A∩B disjoint by cursor_field — no item appears on both pages.
 *   • has_more consistency — if B is empty, has_more must be false.
 *   • A.length == limit when page A advertises has_more=true — a partial
 *     first page with has_more=true is a server bug.
 *
 * Severity policy: HIGH. The dominant signal class is duplicates (data
 * loss / off-by-one); has_more inconsistency surfaces in the same
 * finding via `evidence.kind`.
 *
 * Anti-FP guards:
 *   • Page A empty → skip ("empty collection — no data to paginate").
 *   • Cursor field missing on last item → skip with reason naming the
 *     field so the operator can fix the yaml.
 *   • 4xx/5xx on either page → broken-baseline skip.
 *   • Concurrent writes can race the probe; this MVP doesn't double-
 *     sweep yet (ARV-171 acceptance #2 calls for it). A second sweep
 *     wrapper will land alongside the data-quality work in ARV-187 —
 *     today the finding is gated on cursor-field disjointness which is
 *     much harder to false-positive than counter checks.
 *
 * Pagination types other than `cursor`: skip with explicit reason so
 * `page` / `offset` / `token` callers know the yaml block parsed but
 * the check has no logic for them yet.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { CrudStatefulCheck } from "../stateful.ts";
import type { PaginationConfig } from "../../generator/resources-builder.ts";
import { fillPathParams } from "./_crud-helpers.ts";

/** Cursor-style query params we recognise on auto-detect (Stripe,
 *  GitHub, Resend, Linear). Lower-cased for case-insensitive match. */
const CURSOR_QUERY_NAMES = new Set([
  "starting_after",
  "after",
  "cursor",
  "page_token",
  "next_cursor",
]);

const DEFAULT_LIMIT_PARAM = "limit";
const DEFAULT_CURSOR_FIELD = "id";
const DEFAULT_HAS_MORE_FIELD = "has_more";
/** Probe page size — small so two requests land fast and (more
 *  importantly) so the probe doesn't repeatedly hammer a 1000-item
 *  endpoint just to assert "no duplicates on consecutive pages". */
const DEFAULT_LIMIT = 2;
const ITEMS_FIELD_FALLBACKS: ReadonlyArray<string> = ["data", "items", "results", "value"];

function safeParse(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
}

function detectCursorParam(list: { parameters: OpenAPIV3.ParameterObject[] }): string | null {
  for (const p of list.parameters) {
    if (p.in !== "query") continue;
    if (CURSOR_QUERY_NAMES.has(p.name.toLowerCase())) return p.name;
  }
  return null;
}

function resolveConfig(
  cfg: PaginationConfig | undefined,
  list: { parameters: OpenAPIV3.ParameterObject[] },
): { type: "cursor"; cursorParam: string; cursorField: string; hasMoreField: string; limitParam: string; limit: number; itemsField: string | null } | { type: PaginationConfig["type"]; reason: string } | null {
  const type = cfg?.type ?? "cursor";
  if (type !== "cursor") {
    return { type, reason: `pagination type "${type}" not implemented yet — cursor-style only in this milestone` };
  }
  const cursorParam = cfg?.cursorParam ?? detectCursorParam(list);
  if (!cursorParam) return null;
  return {
    type: "cursor",
    cursorParam,
    cursorField: cfg?.cursorField ?? DEFAULT_CURSOR_FIELD,
    hasMoreField: cfg?.hasMoreField ?? DEFAULT_HAS_MORE_FIELD,
    limitParam: cfg?.limitParam ?? DEFAULT_LIMIT_PARAM,
    limit: cfg?.defaultLimit ?? DEFAULT_LIMIT,
    itemsField: cfg?.itemsField ?? null,
  };
}

/** Find the array-of-items in a list response. Tries the explicit
 *  yaml field first, then a small set of common shapes. Returns null
 *  when the body shape is not recognisable. */
function extractItems(body: unknown, itemsField: string | null): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  if (itemsField) {
    const v = obj[itemsField];
    return Array.isArray(v) ? v : null;
  }
  for (const f of ITEMS_FIELD_FALLBACKS) {
    const v = obj[f];
    if (Array.isArray(v)) return v;
  }
  return null;
}

function readHasMore(body: unknown, field: string): boolean | undefined {
  if (!body || typeof body !== "object") return undefined;
  const v = (body as Record<string, unknown>)[field];
  return typeof v === "boolean" ? v : undefined;
}

function pickCursor(item: unknown, field: string): string | number | null {
  if (item == null || typeof item !== "object") return null;
  const v = (item as Record<string, unknown>)[field];
  if (typeof v === "string" || typeof v === "number") return v;
  return null;
}

function buildUrl(base: string, path: string, pathVars: Record<string, string> | undefined, qs: Record<string, string | number>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(qs)) params.append(k, String(v));
  return `${base.replace(/\/+$/, "")}${fillPathParams(path, pathVars)}?${params.toString()}`;
}

export const paginationInvariants: CrudStatefulCheck = {
  id: "pagination_invariants",
  severity: "high",
  defaultExpected: "Consecutive cursor pages must be disjoint and has_more must agree with item presence",
  references: [{ id: "ARV-171" }],
  phase: "crud",
  applies(g) {
    return Boolean(g.list);
  },
  async run(g, h) {
    if (h.bootstrapCleanupFailed) {
      return { kind: "skip", reason: "bootstrap-cleanup failed — stateful checks paused" };
    }
    const list = g.list!;

    const cfg = h.resourceConfigs?.get(g.resource)?.pagination;
    const resolved = resolveConfig(cfg, list);
    if (resolved == null) {
      return { kind: "skip", reason: "no pagination config and no cursor-style query param in spec" };
    }
    if ("reason" in resolved) {
      return { kind: "skip", reason: resolved.reason };
    }

    const baseHeaders = { Accept: "application/json", ...h.authHeaders };
    const urlA = buildUrl(h.baseUrl, list.path, h.pathVars, { [resolved.limitParam]: resolved.limit });

    const rA = await h.send({ method: "GET", url: urlA, headers: baseHeaders });
    if (rA.status < 200 || rA.status >= 300) {
      return { kind: "skip", reason: `page A returned ${rA.status} — broken-baseline guard` };
    }
    const bodyA = rA.body_parsed ?? safeParse(rA.body);
    const itemsA = extractItems(bodyA, resolved.itemsField);
    if (itemsA == null) {
      return { kind: "skip", reason: `page A: items array not found (tried items_field="${resolved.itemsField ?? "auto"}" + defaults)` };
    }
    if (itemsA.length === 0) {
      return { kind: "skip", reason: "page A empty — no data to paginate" };
    }

    const hasMoreA = readHasMore(bodyA, resolved.hasMoreField);
    const partialPageWithMore = hasMoreA === true && itemsA.length < resolved.limit;

    const lastCursor = pickCursor(itemsA[itemsA.length - 1], resolved.cursorField);
    if (lastCursor == null) {
      return { kind: "skip", reason: `cursor field "${resolved.cursorField}" missing on last item of page A` };
    }

    const urlB = buildUrl(h.baseUrl, list.path, h.pathVars, {
      [resolved.limitParam]: resolved.limit,
      [resolved.cursorParam]: lastCursor,
    });
    const rB = await h.send({ method: "GET", url: urlB, headers: baseHeaders });
    if (rB.status < 200 || rB.status >= 300) {
      return { kind: "skip", reason: `page B returned ${rB.status} — broken-baseline guard` };
    }
    const bodyB = rB.body_parsed ?? safeParse(rB.body);
    const itemsB = extractItems(bodyB, resolved.itemsField);
    if (itemsB == null) {
      return { kind: "skip", reason: "page B: items array shape changed between pages" };
    }
    const hasMoreB = readHasMore(bodyB, resolved.hasMoreField);

    const idsA = new Set<string>();
    for (const it of itemsA) {
      const c = pickCursor(it, resolved.cursorField);
      if (c != null) idsA.add(String(c));
    }
    const duplicates: string[] = [];
    for (const it of itemsB) {
      const c = pickCursor(it, resolved.cursorField);
      if (c != null && idsA.has(String(c))) duplicates.push(String(c));
    }

    // has_more must be false on the page that ran out of items.
    const inconsistentHasMore = itemsB.length === 0 && hasMoreA === true && hasMoreB !== false;

    if (duplicates.length === 0 && !inconsistentHasMore && !partialPageWithMore) {
      return { kind: "pass" };
    }

    const kinds: string[] = [];
    if (duplicates.length > 0) kinds.push("duplicate_items");
    if (inconsistentHasMore) kinds.push("has_more_inconsistent");
    if (partialPageWithMore) kinds.push("partial_page_with_has_more");

    return {
      kind: "fail",
      message:
        duplicates.length > 0
          ? `Pagination on ${g.resource}: ${duplicates.length} item id(s) appear on both pages (${duplicates.slice(0, 3).join(", ")}${duplicates.length > 3 ? ", …" : ""})`
          : inconsistentHasMore
            ? `Pagination on ${g.resource}: page A advertised has_more=true but page B is empty with has_more!=false`
            : `Pagination on ${g.resource}: page A has ${itemsA.length}/${resolved.limit} items yet has_more=true (partial page with more)`,
      evidence: {
        resource: g.resource,
        kind: kinds.join("+"),
        cursor_param: resolved.cursorParam,
        cursor_field: resolved.cursorField,
        page_a_size: itemsA.length,
        page_b_size: itemsB.length,
        has_more_a: hasMoreA,
        has_more_b: hasMoreB,
        duplicates,
      },
    };
  },
};

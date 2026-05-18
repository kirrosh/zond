/**
 * `pagination_invariants` (m-20 ARV-171, ARV-220 added page-style in m-21)
 * — list-endpoint pagination consistency.
 *
 * Two styles are implemented, gated on the `pagination.type` annotation
 * (and on auto-detection from the OpenAPI spec query params):
 *
 *  ── Cursor style (Stripe / Notion / Linear) ─────────────────────────
 *   1. GET ?limit=N → page A.
 *   2. Pick the last item's cursor field (default `id`).
 *   3. GET ?<cursor_param>=<last_id>&limit=N → page B.
 *   Invariants:
 *     • A∩B disjoint by cursor_field — no item appears on both pages.
 *     • has_more consistency — if B is empty, has_more must be false.
 *     • A.length == limit when page A advertises has_more=true.
 *
 *  ── Page-number style (GitHub / GitLab / Atlassian) ────────────────
 *   1. GET ?page=START&per_page=N → page A.
 *   2. GET ?page=START+1&per_page=N → page B.
 *   Invariants:
 *     • A∩B disjoint by cursor_field — same data-loss signal.
 *     • per_page respected — neither page may exceed N items (server bug
 *       if e.g. per_page=2 returns 5).
 *   has_more is NOT enforced for page-style: most APIs in this family
 *   signal end-of-list via Link headers / total_pages rather than a
 *   body boolean, so a missing has_more field is normal.
 *
 * Severity matrix (ARV-288, follow-up to ARV-284 pattern):
 *
 *   declared severity = 'low' (proof-cap baseline per ARV-250 — stateful
 *   two-page probe is single-signal without an out-of-band diff confirmation).
 *
 *   Per-finding dispatch via `outcome.severity` (applied in BOTH
 *   runCursorStyle and runPageStyle):
 *
 *     HIGH   — `kinds` contains 'duplicate_items': items overlap on
 *               consecutive pages → real data-loss / off-by-one evidence
 *               chain → can reach HIGH (evidence_chain proof).
 *
 *     MEDIUM — all other `kinds` only (`has_more_inconsistent`,
 *               `partial_page_with_has_more`, `per_page_exceeded`):
 *               protocol bugs / single-signal contract violations per
 *               ARV-250. Escalated above declared baseline because a
 *               concrete invariant is broken, but no data-loss evidence.
 *
 * References: ARV-250 (proof-cap ladder), ARV-284 (per-finding pattern).
 *
 * Anti-FP guards (both styles):
 *   • Page A empty → skip ("empty collection — no data to paginate").
 *   • Cursor field missing on last item (cursor style) → skip naming the
 *     field so the operator can fix the yaml.
 *   • 4xx/5xx on either page → broken-baseline skip.
 *   • Concurrent writes can race the probe; MVP doesn't double-sweep.
 *
 * Types other than `cursor` / `page` (`offset`, `token`): skip with an
 * explicit reason so callers know the yaml block parsed but the check
 * has no logic for them yet.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { CrudStatefulCheck } from "../stateful.ts";
import type { Severity } from "../../severity/index.ts";
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

const DEFAULT_LIMIT_PARAM_CURSOR = "limit";
const DEFAULT_LIMIT_PARAM_PAGE = "per_page";
const DEFAULT_PAGE_PARAM = "page";
const DEFAULT_START_PAGE = 1;
const DEFAULT_CURSOR_FIELD = "id";
const DEFAULT_HAS_MORE_FIELD = "has_more";
/** Probe page size — small so two requests land fast and (more
 *  importantly) so the probe doesn't repeatedly hammer a 1000-item
 *  endpoint just to assert "no duplicates on consecutive pages". */
const DEFAULT_LIMIT = 2;
const ITEMS_FIELD_FALLBACKS: ReadonlyArray<string> = ["data", "items", "results", "value"];

/** Query-param names that signal a page-number-style endpoint when no
 *  yaml annotation is present (GitHub/GitLab/Atlassian/Notion). */
const PAGE_QUERY_NAMES = new Set(["page", "page_number", "pagenumber"]);

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

function detectPageParam(list: { parameters: OpenAPIV3.ParameterObject[] }): string | null {
  for (const p of list.parameters) {
    if (p.in !== "query") continue;
    if (PAGE_QUERY_NAMES.has(p.name.toLowerCase())) return p.name;
  }
  return null;
}

type CursorResolved = {
  type: "cursor";
  cursorParam: string;
  cursorField: string;
  hasMoreField: string;
  limitParam: string;
  limit: number;
  itemsField: string | null;
};

type PageResolved = {
  type: "page";
  pageParam: string;
  startPage: number;
  cursorField: string;
  limitParam: string;
  limit: number;
  itemsField: string | null;
};

type SkipResolved = { type: PaginationConfig["type"]; reason: string };

function resolveConfig(
  cfg: PaginationConfig | undefined,
  list: { parameters: OpenAPIV3.ParameterObject[] },
): CursorResolved | PageResolved | SkipResolved | null {
  // Type resolution: explicit yaml wins; otherwise prefer cursor-style
  // auto-detection (Stripe-shaped APIs are the cleaner default), then
  // fall back to page-style detection.
  let type = cfg?.type;
  if (!type) {
    if (detectCursorParam(list)) type = "cursor";
    else if (detectPageParam(list)) type = "page";
    else type = "cursor"; // no signal — will hit the null-return below
  }

  if (type === "cursor") {
    const cursorParam = cfg?.cursorParam ?? detectCursorParam(list);
    if (!cursorParam) return null;
    return {
      type: "cursor",
      cursorParam,
      cursorField: cfg?.cursorField ?? DEFAULT_CURSOR_FIELD,
      hasMoreField: cfg?.hasMoreField ?? DEFAULT_HAS_MORE_FIELD,
      limitParam: cfg?.limitParam ?? DEFAULT_LIMIT_PARAM_CURSOR,
      limit: cfg?.defaultLimit ?? DEFAULT_LIMIT,
      itemsField: cfg?.itemsField ?? null,
    };
  }

  if (type === "page") {
    return {
      type: "page",
      pageParam: cfg?.pageParam ?? detectPageParam(list) ?? DEFAULT_PAGE_PARAM,
      startPage: cfg?.startPage ?? DEFAULT_START_PAGE,
      cursorField: cfg?.cursorField ?? DEFAULT_CURSOR_FIELD,
      limitParam: cfg?.limitParam ?? DEFAULT_LIMIT_PARAM_PAGE,
      limit: cfg?.defaultLimit ?? DEFAULT_LIMIT,
      itemsField: cfg?.itemsField ?? null,
    };
  }

  return { type, reason: `pagination type "${type}" not implemented yet — only cursor and page are supported` };
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
  // ARV-288: declared severity is the proof-cap baseline (low) per ARV-250.
  // Per-finding severity is dispatched via outcome.severity in run() below:
  // duplicate_items (data-loss evidence chain) → high; protocol-only kinds → medium.
  severity: "low",
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
      return { kind: "skip", reason: "no pagination config and no cursor/page query param in spec" };
    }
    if ("reason" in resolved) {
      return { kind: "skip", reason: resolved.reason };
    }

    if (resolved.type === "cursor") return runCursorStyle(g, h, list, resolved);
    return runPageStyle(g, h, list, resolved);
  },
};

async function runCursorStyle(
  g: Parameters<CrudStatefulCheck["run"]>[0],
  h: Parameters<CrudStatefulCheck["run"]>[1],
  list: NonNullable<typeof g.list>,
  resolved: CursorResolved,
): ReturnType<CrudStatefulCheck["run"]> {
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

  const duplicates = findDuplicates(itemsA, itemsB, resolved.cursorField);

  // has_more must be false on the page that ran out of items.
  const inconsistentHasMore = itemsB.length === 0 && hasMoreA === true && hasMoreB !== false;

  if (duplicates.length === 0 && !inconsistentHasMore && !partialPageWithMore) {
    return { kind: "pass" };
  }

  const kinds: string[] = [];
  if (duplicates.length > 0) kinds.push("duplicate_items");
  if (inconsistentHasMore) kinds.push("has_more_inconsistent");
  if (partialPageWithMore) kinds.push("partial_page_with_has_more");

  // ARV-288: per-finding severity dispatch.
  const severity: Severity = kinds.includes("duplicate_items") ? "high" : "medium";

  return {
    kind: "fail",
    severity,
    message:
      duplicates.length > 0
        ? `Pagination on ${g.resource}: ${duplicates.length} item id(s) appear on both pages (${duplicates.slice(0, 3).join(", ")}${duplicates.length > 3 ? ", …" : ""})`
        : inconsistentHasMore
          ? `Pagination on ${g.resource}: page A advertised has_more=true but page B is empty with has_more!=false`
          : `Pagination on ${g.resource}: page A has ${itemsA.length}/${resolved.limit} items yet has_more=true (partial page with more)`,
    evidence: {
      resource: g.resource,
      kind: kinds.join("+"),
      style: "cursor",
      cursor_param: resolved.cursorParam,
      cursor_field: resolved.cursorField,
      page_a_size: itemsA.length,
      page_b_size: itemsB.length,
      has_more_a: hasMoreA,
      has_more_b: hasMoreB,
      duplicates,
    },
  };
}

async function runPageStyle(
  g: Parameters<CrudStatefulCheck["run"]>[0],
  h: Parameters<CrudStatefulCheck["run"]>[1],
  list: NonNullable<typeof g.list>,
  resolved: PageResolved,
): ReturnType<CrudStatefulCheck["run"]> {
  const baseHeaders = { Accept: "application/json", ...h.authHeaders };
  const urlA = buildUrl(h.baseUrl, list.path, h.pathVars, {
    [resolved.pageParam]: resolved.startPage,
    [resolved.limitParam]: resolved.limit,
  });

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

  const urlB = buildUrl(h.baseUrl, list.path, h.pathVars, {
    [resolved.pageParam]: resolved.startPage + 1,
    [resolved.limitParam]: resolved.limit,
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

  const duplicates = findDuplicates(itemsA, itemsB, resolved.cursorField);
  const perPageBreach = itemsA.length > resolved.limit || itemsB.length > resolved.limit;

  if (duplicates.length === 0 && !perPageBreach) {
    return { kind: "pass" };
  }

  const kinds: string[] = [];
  if (duplicates.length > 0) kinds.push("duplicate_items");
  if (perPageBreach) kinds.push("per_page_exceeded");

  // ARV-288: per-finding severity dispatch.
  const severity: Severity = kinds.includes("duplicate_items") ? "high" : "medium";

  return {
    kind: "fail",
    severity,
    message:
      duplicates.length > 0
        ? `Pagination on ${g.resource}: ${duplicates.length} item id(s) appear on pages ${resolved.startPage} and ${resolved.startPage + 1} (${duplicates.slice(0, 3).join(", ")}${duplicates.length > 3 ? ", …" : ""})`
        : `Pagination on ${g.resource}: per_page=${resolved.limit} not respected — server returned ${itemsA.length}/${itemsB.length} items`,
    evidence: {
      resource: g.resource,
      kind: kinds.join("+"),
      style: "page",
      page_param: resolved.pageParam,
      per_page: resolved.limit,
      page_a_number: resolved.startPage,
      page_b_number: resolved.startPage + 1,
      page_a_size: itemsA.length,
      page_b_size: itemsB.length,
      cursor_field: resolved.cursorField,
      duplicates,
    },
  };
}

function findDuplicates(a: unknown[], b: unknown[], cursorField: string): string[] {
  const ids = new Set<string>();
  for (const it of a) {
    const c = pickCursor(it, cursorField);
    if (c != null) ids.add(String(c));
  }
  const dups: string[] = [];
  for (const it of b) {
    const c = pickCursor(it, cursorField);
    if (c != null && ids.has(String(c))) dups.push(String(c));
  }
  return dups;
}

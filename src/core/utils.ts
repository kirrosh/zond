/**
 * ARV-418: a read-by-id that returns HTTP 200 with a top-level `deleted: true`
 * is the REST soft-delete convention (Stripe returns a deleted-stub object, not
 * a 404). A status-code-only liveness check misreads it as live. This is the
 * ONE marker proven by a real spec (Stripe, run#3) — do NOT grow it into a
 * list of speculative markers (`is_deleted`, `archived`, …) "just in case";
 * add another only under a real spec that exercises it (see src/CLAUDE.md
 * Evidence-over-inference).
 */
export function isSoftDeletedBody(body: unknown): boolean {
  return (
    body != null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    (body as Record<string, unknown>).deleted === true
  );
}

export function getByPath(obj: unknown, path: string, defaultVal?: unknown): unknown {
  // Normalize JSONPath-like bracket indexing (`data[0].id`) to dotted form
  // (`data.0.id`) so callers can use either spelling. Numeric segments also
  // index arrays correctly because `array["0"]` is equivalent to `array[0]`.
  const normalized = path.replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "");
  const keys = normalized.split(".");
  let result: unknown = obj;
  for (const key of keys) {
    result = (result as Record<string, unknown>)?.[key];
    if (result === undefined) return defaultVal;
  }
  return result;
}

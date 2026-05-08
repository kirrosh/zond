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

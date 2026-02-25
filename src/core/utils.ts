export function getByPath(obj: unknown, path: string, defaultVal?: unknown): unknown {
  const keys = path.split(".");
  let result: unknown = obj;
  for (const key of keys) {
    result = (result as Record<string, unknown>)?.[key];
    if (result === undefined) return defaultVal;
  }
  return result;
}

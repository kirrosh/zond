/**
 * Shared id-extraction helpers for stateful CRUD checks (m-15 ARV-3).
 * Kept under `_` prefix so it doesn't get auto-registered.
 */

export function fillPathWithId(path: string, idParam: string, id: string | number): string {
  const v = encodeURIComponent(String(id));
  return path
    .replace(new RegExp(`\\{${idParam}\\}`), v)
    // Fallback: any single placeholder gets replaced.
    .replace(/\{[^}]+\}/g, v);
}

/**
 * Pull a usable id out of a create-response body. Honours the spec's
 * declared `idParam` first (so `userId` matches `user_id` / `userId`),
 * then falls back to a list of common keys. Returns null if nothing
 * looks like a usable id.
 */
export function extractIdFromCreateResponse(body: unknown, idParam: string): string | number | null {
  if (body == null || typeof body !== "object") {
    if (typeof body === "string" || typeof body === "number") return body;
    return null;
  }
  // Strings often arrive as parsed JSON via http-client; treat both.
  const obj = body as Record<string, unknown>;
  const candidates = [
    idParam,
    idParam.replace(/[_-]/g, ""),
    "id",
    "uuid",
    "slug",
    "name",
    "key",
  ];
  for (const k of candidates) {
    const v = obj[k];
    if (typeof v === "string" || typeof v === "number") return v;
  }
  // common SaaS-style { data: { id } } envelope.
  const data = obj.data as Record<string, unknown> | undefined;
  if (data && typeof data === "object") {
    for (const k of candidates) {
      const v = data[k];
      if (typeof v === "string" || typeof v === "number") return v;
    }
  }
  return null;
}

/**
 * ARV-149 / ARV-150: encode a nested JS object as
 * `application/x-www-form-urlencoded` using bracket notation — the
 * canonical Stripe / Rails / PHP convention for nested fields:
 *
 *   { address: { line1: "x", line2: "y" }, items: [{ id: 1 }, { id: 2 }] }
 *   →  address[line1]=x&address[line2]=y&items[0][id]=1&items[1][id]=2
 *
 * Shared between `zond request --form`, the YAML runner's `form:` step,
 * and the mass-assignment probe's form-bodied endpoints. The probe-side
 * adoption (ARV-150) is what restores 265 SKIPPED Stripe endpoints.
 */
function appendFormParam(params: URLSearchParams, key: string, value: unknown): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) appendFormParam(params, `${key}[${i}]`, value[i]);
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      appendFormParam(params, `${key}[${k}]`, v);
    }
  } else {
    params.append(key, String(value));
  }
}

export function encodeFormBody(body: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) appendFormParam(params, k, v);
  return params.toString();
}

/** Flatten a nested JS object to a `Record<string, string>` using the same
 *  bracket-notation walk as `encodeFormBody`, suitable for the YAML
 *  runner's `form:` step (which is typed as `Record<string, string>` and
 *  serialised via `URLSearchParams`). */
export function flattenToFormFields(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object") return {};
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) appendFormParam(params, k, v);
  return Object.fromEntries(params.entries());
}

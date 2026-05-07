/**
 * SecretRegistry — runtime registry of secret values + sanitizer
 * (TASK-166, m-10).
 *
 * The registry is the single point that knows "this string is a secret;
 * if you see it anywhere in a request URL, body, response, log line, or
 * exporter, replace it with `<redacted:<var-name>>`". Every persisted
 * artifact path (DB-write — TASK-167, exporters — TASK-168) calls
 * `redact()` / `redactObject()` before writing, so the user can ship a
 * digest / HTML report without scrubbing tokens by hand.
 *
 * Design rules:
 *   - Exact-match only — no heuristics ("looks like a JWT", "starts with
 *     `sk_`"). False positives are worse than false negatives here.
 *   - Minimum length 8 — protects against `auth_token: ""` or `id: 1`
 *     turning every "1" in the report into `<redacted>`.
 *   - One marker format documented in one place: `<redacted:<name>>`.
 *   - `setEnabled(false)` returns a no-op redactor for `--no-redact` (local
 *     debug). Default is enabled.
 *
 * Marker format: `<redacted:auth_token>` — the name comes from the
 * variable that registered the value (e.g. `.env.yaml` key, `--env` flag,
 * `.secrets.yaml` future entry). Anything that opens a redacted artifact
 * sees the variable name and knows where to look it up locally.
 */

/** Minimum length below which a registered value is silently ignored. */
export const MIN_SECRET_LENGTH = 8;

const REDACTED_MARKER_RE = /<redacted:[a-zA-Z0-9_.-]+>/;

export interface SecretEntry {
  name: string;
  value: string;
}

export class SecretRegistry {
  /** value → name. We keep map keyed by *value* so a single redact pass
   *  iterates the unique values rather than all registrations. Two names
   *  registering the same value collapse to one entry — the most recent
   *  wins. */
  private byValue = new Map<string, string>();
  private enabled = true;

  register(name: string, value: unknown): void {
    if (typeof value !== "string") return;
    if (value.length < MIN_SECRET_LENGTH) return;
    this.byValue.set(value, name);
  }

  /**
   * Bulk-register every string value in a flat object. Used by
   * `.env.yaml` / `.secrets.yaml` loaders so we don't have to know in
   * advance which keys are sensitive. The variable name carried into the
   * marker is the object key.
   */
  registerAll(entries: Record<string, unknown> | undefined | null): void {
    if (!entries) return;
    for (const [k, v] of Object.entries(entries)) this.register(k, v);
  }

  /** Disable redaction (for `--no-redact` local debug). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Names of every var that had a value registered. Stable diagnostic. */
  redactedNames(): string[] {
    return [...new Set(this.byValue.values())].sort();
  }

  hasSecrets(): boolean {
    return this.byValue.size > 0;
  }

  /** Drop all registered secrets — used between test cases. */
  clear(): void {
    this.byValue.clear();
  }

  /**
   * Replace every occurrence of a registered value in `text` with the
   * marker `<redacted:<name>>`. Longest values first, so a token that
   * happens to contain a shorter registered substring still ends up
   * redacted as the more-specific match.
   */
  redact(text: string): string {
    if (!this.enabled || this.byValue.size === 0) return text;
    if (typeof text !== "string" || text.length === 0) return text;

    let out = text;
    for (const [value, name] of this.sortedEntries()) {
      if (out.indexOf(value) === -1) continue;
      out = out.split(value).join(`<redacted:${name}>`);
    }
    return out;
  }

  /**
   * Deep-clone variant for arbitrary structured data (request/response
   * bodies, header maps, JSON envelopes). Strings get redacted; numbers,
   * booleans, null, Buffers stay as-is. Cycles are not expected on the
   * artifact paths but we guard with `seen` to be safe.
   */
  redactObject<T>(obj: T): T {
    if (!this.enabled || this.byValue.size === 0) return obj;
    return this.deepRedact(obj, new WeakSet()) as T;
  }

  private sortedEntries(): Array<[string, string]> {
    return [...this.byValue.entries()].sort((a, b) => b[0].length - a[0].length);
  }

  private deepRedact(node: unknown, seen: WeakSet<object>): unknown {
    if (node == null) return node;
    if (typeof node === "string") return this.redact(node);
    if (typeof node !== "object") return node;
    if (seen.has(node as object)) return node;
    seen.add(node as object);

    if (Array.isArray(node)) {
      return node.map((v) => this.deepRedact(v, seen));
    }
    // Buffers / Uint8Array / Date — leave intact.
    if (node instanceof Uint8Array || node instanceof Date) return node;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = this.deepRedact(v, seen);
    }
    return out;
  }
}

/**
 * Process-wide registry. CLI commands populate it once after loading
 * `.env.yaml` / `.secrets.yaml`; library callers can pass their own
 * instance instead of touching this singleton in tests.
 */
let globalRegistry: SecretRegistry | undefined;

export function getSecretRegistry(): SecretRegistry {
  if (!globalRegistry) globalRegistry = new SecretRegistry();
  return globalRegistry;
}

/** Replace the global registry. Tests use this to reset state. */
export function setSecretRegistry(reg: SecretRegistry): void {
  globalRegistry = reg;
}

/** Convenience: redact a string via the global registry. */
export function redact(text: string): string {
  return getSecretRegistry().redact(text);
}

/** Convenience: redact a nested object via the global registry. */
export function redactObject<T>(value: T): T {
  return getSecretRegistry().redactObject(value);
}

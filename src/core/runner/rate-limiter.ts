export interface RateLimiter {
  acquire(): Promise<void>;
  /**
   * Feed rate-limit metadata from the latest response back into the limiter.
   * Two effects: (1) when `remaining` falls at or below the threshold, the
   * limiter postpones the next acquire until the API's reset window expires;
   * (2) when the response carries a `RateLimit-Policy` (RFC 9568), the
   * limiter learns the per-request spacing so subsequent parallel acquires
   * are forced into single-file at burst=1.
   *
   * Optional so existing callers / mocks need not implement it.
   */
  note?(meta: RateLimitMeta, now?: number): void;
}

export interface RateLimitMeta {
  /** Requests remaining in the current window. */
  remaining?: number;
  /** Either seconds-until-reset (RFC draft) or a Unix epoch in seconds (GitHub style). */
  reset?: number;
  /** Window cap; used for diagnostics and spacing fallback. */
  limit?: number;
  /**
   * Minimum spacing between requests in ms — derived from `RateLimit-Policy:
   * N;w=W` (RFC 9568). When set, the limiter raises its own interval to at
   * least this value so a burst of parallel requests is paced one-by-one
   * instead of overshooting the window.
   */
  intervalMs?: number;
}

/**
 * When `remaining` is at or below this number we proactively pause until reset.
 * Conservative threshold — at 2, we still have buffer for one in-flight retry
 * (if we paused at 5 we'd over-throttle on small windows like Resend's 5/1s,
 * where every request would trigger a sleep).
 */
const THROTTLE_THRESHOLD = 2;

/**
 * Padding added to policy-derived spacing to absorb clock drift between the
 * server's window and our local Date.now() (TASK-88). Without this, spacing
 * exactly at `W/N` ms can still hit the window boundary on the wrong side.
 */
const POLICY_SAFETY_MS = 50;

/** Magnitudes above this are treated as Unix timestamps; below as relative
 *  seconds. 10^9 seconds ≈ Sep 2001, so any real reset window is far below. */
const UNIX_TS_BOUNDARY = 1_000_000_000;

function applyResetPause(prevNextAvailable: number, meta: RateLimitMeta, now: number): number {
  if (meta.remaining === undefined) return prevNextAvailable;
  if (meta.remaining > THROTTLE_THRESHOLD) return prevNextAvailable;
  if (meta.reset === undefined || !Number.isFinite(meta.reset)) return prevNextAvailable;
  const resetMs = meta.reset > UNIX_TS_BOUNDARY ? meta.reset * 1000 : now + Math.max(0, meta.reset) * 1000;
  return Math.max(prevNextAvailable, resetMs);
}

class IntervalRateLimiter implements RateLimiter {
  private nextAvailable = 0;
  private intervalMs: number;

  constructor(reqPerSec: number) {
    if (!Number.isFinite(reqPerSec) || reqPerSec <= 0) {
      throw new Error(`Invalid rate limit: ${reqPerSec}`);
    }
    this.intervalMs = 1000 / reqPerSec;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextAvailable);
    const waitMs = slot - now;
    this.nextAvailable = slot + this.intervalMs;
    if (waitMs > 0) {
      await Bun.sleep(waitMs);
    }
  }

  note(meta: RateLimitMeta, now: number = Date.now()): void {
    if (meta.intervalMs !== undefined && meta.intervalMs > this.intervalMs) {
      // Already-reserved slots were spaced at the OLD interval; push
      // nextAvailable forward by the delta so the new spacing kicks in
      // immediately rather than only on the next-next request.
      this.nextAvailable += meta.intervalMs - this.intervalMs;
      this.intervalMs = meta.intervalMs;
    }
    this.nextAvailable = applyResetPause(this.nextAvailable, meta, now);
  }
}

class AdaptiveRateLimiter implements RateLimiter {
  private nextAvailable = 0;
  /** Learned from RateLimit-Policy. 0 until a policy is seen — until then,
   *  parallel acquires are not spaced (matches the original adaptive
   *  behaviour). Once known, every acquire reserves a slot of `intervalMs`. */
  private intervalMs = 0;

  async acquire(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextAvailable);
    const waitMs = slot - now;
    this.nextAvailable = slot + this.intervalMs;
    if (waitMs > 0) await Bun.sleep(waitMs);
  }

  note(meta: RateLimitMeta, now: number = Date.now()): void {
    if (meta.intervalMs !== undefined && meta.intervalMs > this.intervalMs) {
      this.nextAvailable += meta.intervalMs - this.intervalMs;
      this.intervalMs = meta.intervalMs;
    }
    this.nextAvailable = applyResetPause(this.nextAvailable, meta, now);
  }
}

export function createRateLimiter(reqPerSec: number | undefined): RateLimiter | undefined {
  if (reqPerSec === undefined || reqPerSec === null) return undefined;
  if (!Number.isFinite(reqPerSec) || reqPerSec <= 0) return undefined;
  return new IntervalRateLimiter(reqPerSec);
}

/**
 * Adaptive limiter for `--rate-limit auto`. Issues no proactive throttling on
 * its own initially, but reacts to ratelimit-* response headers via `note()`:
 * (a) pauses the request stream until the API's reset window elapses when
 * remaining headroom drops; (b) once a `RateLimit-Policy` is seen, paces
 * subsequent requests at the policy's `W/N` spacing — this prevents bursts
 * from blowing through small windows (Resend 5/1s, etc.).
 */
export function createAdaptiveRateLimiter(): RateLimiter {
  return new AdaptiveRateLimiter();
}

/**
 * Read RFC 9568 `ratelimit-*` headers (was draft-ietf-httpapi-ratelimit-headers)
 * plus the GitHub / Stripe style `x-ratelimit-*` aliases out of a response
 * header bag. All keys are matched case-insensitively. Unparseable values are
 * dropped.
 *
 * `RateLimit-Policy: N;w=W` is parsed into a per-request `intervalMs` of
 * `(W/N)*1000 + POLICY_SAFETY_MS` so the limiter can pace bursts.
 */
export function parseRateLimitHeaders(headers: Record<string, string>): RateLimitMeta {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const num = (v: string | undefined): number | undefined => {
    if (v === undefined) return undefined;
    // RFC draft `ratelimit-remaining` may carry `q="value"` quoted-string form;
    // strip leading numeric run.
    const match = v.match(/-?\d+(?:\.\d+)?/);
    if (!match) return undefined;
    const n = Number.parseFloat(match[0]);
    return Number.isFinite(n) ? n : undefined;
  };
  const policy = lower["ratelimit-policy"] ?? lower["x-ratelimit-policy"];
  const intervalMs = derivePolicyIntervalMs(policy);
  return {
    limit: num(lower["ratelimit-limit"] ?? lower["x-ratelimit-limit"]),
    remaining: num(lower["ratelimit-remaining"] ?? lower["x-ratelimit-remaining"]),
    reset: num(lower["ratelimit-reset"] ?? lower["x-ratelimit-reset"]),
    intervalMs,
  };
}

/**
 * Parse `RateLimit-Policy: 5;w=1` (or comma-separated multi-policy — we honour
 * the *strictest* one). Returns the implied per-request interval in ms,
 * including a small safety margin. Returns undefined when the header is
 * malformed or missing.
 */
function derivePolicyIntervalMs(policy: string | undefined): number | undefined {
  if (!policy) return undefined;
  let strictest: number | undefined;
  for (const item of policy.split(",")) {
    const parts = item.trim().split(";").map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const limit = Number.parseFloat(parts[0]!);
    if (!Number.isFinite(limit) || limit <= 0) continue;
    const wPart = parts.find(p => p.startsWith("w="));
    if (!wPart) continue;
    const window = Number.parseFloat(wPart.slice(2));
    if (!Number.isFinite(window) || window <= 0) continue;
    const interval = (window / limit) * 1000 + POLICY_SAFETY_MS;
    if (strictest === undefined || interval > strictest) strictest = interval;
  }
  return strictest;
}

export function parseRetryAfter(header: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (trimmed === "") return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number.parseFloat(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    return undefined;
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - now);
  }
  return undefined;
}

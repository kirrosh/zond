export interface RateLimiter {
  acquire(): Promise<void>;
  /**
   * Feed rate-limit metadata from the latest response back into the limiter.
   * When `remaining` falls at or below the threshold, the limiter postpones
   * the next acquire until the API's reset window expires. No-op when the
   * server reports plenty of headroom.
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
  /** Window cap; used only for diagnostics. */
  limit?: number;
}

/** When `remaining` is at or below this number we proactively pause until reset. */
const THROTTLE_THRESHOLD = 5;

/** Magnitudes above this are treated as Unix timestamps; below as relative
 *  seconds. 10^9 seconds ≈ Sep 2001, so any real reset window is far below. */
const UNIX_TS_BOUNDARY = 1_000_000_000;

function applyMeta(prevNextAvailable: number, meta: RateLimitMeta, now: number): number {
  if (meta.remaining === undefined) return prevNextAvailable;
  if (meta.remaining > THROTTLE_THRESHOLD) return prevNextAvailable;
  if (meta.reset === undefined || !Number.isFinite(meta.reset)) return prevNextAvailable;
  const resetMs = meta.reset > UNIX_TS_BOUNDARY ? meta.reset * 1000 : now + Math.max(0, meta.reset) * 1000;
  return Math.max(prevNextAvailable, resetMs);
}

class IntervalRateLimiter implements RateLimiter {
  private nextAvailable = 0;
  private readonly intervalMs: number;

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
    this.nextAvailable = applyMeta(this.nextAvailable, meta, now);
  }
}

class AdaptiveRateLimiter implements RateLimiter {
  private nextAvailable = 0;

  async acquire(): Promise<void> {
    const now = Date.now();
    const wait = this.nextAvailable - now;
    if (wait > 0) await Bun.sleep(wait);
  }

  note(meta: RateLimitMeta, now: number = Date.now()): void {
    this.nextAvailable = applyMeta(this.nextAvailable, meta, now);
  }
}

export function createRateLimiter(reqPerSec: number | undefined): RateLimiter | undefined {
  if (reqPerSec === undefined || reqPerSec === null) return undefined;
  if (!Number.isFinite(reqPerSec) || reqPerSec <= 0) return undefined;
  return new IntervalRateLimiter(reqPerSec);
}

/**
 * Adaptive limiter for `--rate-limit auto`. Issues no proactive throttling on
 * its own, but reacts to ratelimit-* response headers via `note()` and pauses
 * the request stream until the API's reset window elapses when headroom drops.
 */
export function createAdaptiveRateLimiter(): RateLimiter {
  return new AdaptiveRateLimiter();
}

/**
 * Read RFC draft-ietf-httpapi-ratelimit-headers (`ratelimit-*`) plus the
 * GitHub / Stripe style `x-ratelimit-*` aliases out of a response header bag.
 * All keys are matched case-insensitively. Unparseable values are dropped.
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
  return {
    limit: num(lower["ratelimit-limit"] ?? lower["x-ratelimit-limit"]),
    remaining: num(lower["ratelimit-remaining"] ?? lower["x-ratelimit-remaining"]),
    reset: num(lower["ratelimit-reset"] ?? lower["x-ratelimit-reset"]),
  };
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

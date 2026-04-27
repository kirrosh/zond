export interface RateLimiter {
  acquire(): Promise<void>;
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
}

export function createRateLimiter(reqPerSec: number | undefined): RateLimiter | undefined {
  if (reqPerSec === undefined || reqPerSec === null) return undefined;
  if (!Number.isFinite(reqPerSec) || reqPerSec <= 0) return undefined;
  return new IntervalRateLimiter(reqPerSec);
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

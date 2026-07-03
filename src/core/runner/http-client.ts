import type { HttpRequest, HttpResponse } from "./types.ts";
import { type RateLimiter, parseRetryAfter, parseRateLimitHeaders } from "./rate-limiter.ts";

/**
 * ARV-265: module-level audit hook for commands that don't drive their
 * HTTP through the suite runner. Each `executeRequest` call fires the
 * registered recorder with the final outcome (or the swallowed network
 * error if the call exhausted its retry budget). Recorders MUST NOT
 * throw — the http client treats them as fire-and-forget telemetry.
 *
 * Convention: a command sets the recorder before the live work begins,
 * unsets it in a `finally` block. There can be at most one recorder at
 * a time; nesting is a bug (we surface it on stderr but keep the inner
 * recorder so the live command's results take precedence).
 */
export interface AuditRecord {
  request: HttpRequest;
  response?: HttpResponse;
  durationMs: number;
  error?: string;
}

let _auditRecorder: ((rec: AuditRecord) => void) | null = null;

export function setHttpAuditRecorder(recorder: ((rec: AuditRecord) => void) | null): void {
  if (recorder && _auditRecorder) {
    process.stderr.write("zond: nested HTTP audit recorder — overriding the outer scope.\n");
  }
  _auditRecorder = recorder;
}

export interface FetchOptions {
  timeout: number;
  retries: number;
  retry_delay: number;
  follow_redirects: boolean;
  rate_limiter?: RateLimiter;
  rate_limit_retries: number;
  rate_limit_max_delay_ms: number;
  /** TASK-144: number of network-level retries (ECONNRESET, EPIPE, socket hang
   *  up, fetch failed without HTTP response, timeout without response). HTTP
   *  status codes are NEVER retried by this path. Exponential backoff with
   *  jitter, base = `network_retry_base_ms`. Default 0 (CLI sets it to 1). */
  network_retries: number;
  network_retry_base_ms: number;
  network_retry_max_delay_ms: number;
}

const DEFAULT_FETCH_OPTIONS: FetchOptions = {
  timeout: 30000,
  retries: 0,
  retry_delay: 1000,
  follow_redirects: true,
  rate_limit_retries: 5,
  rate_limit_max_delay_ms: 30000,
  network_retries: 0,
  network_retry_base_ms: 250,
  network_retry_max_delay_ms: 8000,
};

/**
 * Recognise transient TCP/transport-level errors that warrant a retry. We
 * deliberately do NOT include HTTP status codes — a 5xx is a real response
 * the server chose to send, not a flaky socket. Patterns cover Node/Bun
 * error codes (`ECONNRESET`, `EPIPE`, `ECONNREFUSED`, `ETIMEDOUT`,
 * `EAI_AGAIN`), the WHATWG `fetch failed` wrapper Bun throws, classic
 * `socket hang up`, and `AbortError` raised by our own timeout watchdog.
 */
export function isTransientNetworkError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: string; cause?: unknown; name?: string; message?: string };
  const code = e.code ?? (e.cause as { code?: string } | undefined)?.code;
  if (code) {
    if (
      code === "ECONNRESET" ||
      code === "EPIPE" ||
      code === "ECONNREFUSED" ||
      code === "ETIMEDOUT" ||
      code === "EAI_AGAIN" ||
      code === "ENOTFOUND" ||
      code === "ENETUNREACH"
    ) {
      return true;
    }
  }
  const msg = (e.message ?? String(err)).toLowerCase();
  if (e.name === "AbortError" || msg.includes("aborted")) return true;
  if (msg.includes("socket hang up")) return true;
  if (msg.includes("fetch failed")) return true;
  if (msg.includes("connection reset") || msg.includes("econnreset")) return true;
  if (msg.includes("epipe")) return true;
  if (msg.includes("network error")) return true;
  return false;
}

/** Exponential backoff with full jitter (AWS-style): pick uniformly in
 *  [0, min(cap, base * 2^attempt)). Returns ms. */
export function networkBackoffMs(attempt: number, baseMs: number, capMs: number): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

export async function executeRequest(
  request: HttpRequest,
  options?: Partial<FetchOptions>,
): Promise<HttpResponse> {
  const opts = { ...DEFAULT_FETCH_OPTIONS, ...options };
  let lastError: Error | undefined;
  let networkAttempt = 0;
  let networkRetryCount = 0;
  let rate429Attempt = 0;

  while (true) {
    if (opts.rate_limiter) {
      await opts.rate_limiter.acquire();
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), opts.timeout);
      const start = performance.now();

      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.formData ?? request.body ?? undefined,
        signal: controller.signal,
        redirect: opts.follow_redirects ? "follow" : "manual",
        tls: { rejectUnauthorized: false },
      });

      clearTimeout(timeoutId);
      const duration_ms = Math.round(performance.now() - start);

      if (response.status === 429 && rate429Attempt < opts.rate_limit_retries) {
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        const backoffMs = Math.min(
          opts.retry_delay * 2 ** rate429Attempt,
          opts.rate_limit_max_delay_ms,
        );
        const waitMs = Math.min(retryAfterMs ?? backoffMs, opts.rate_limit_max_delay_ms);
        rate429Attempt++;
        // Drain body so the connection can be reused
        await response.text().catch(() => undefined);
        await Bun.sleep(waitMs);
        continue;
      }

      const bodyText = await response.text();
      let body_parsed: unknown = undefined;
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        try {
          body_parsed = JSON.parse(bodyText);
        } catch {
          // Body is not valid JSON despite content-type
        }
      }
      // Fallback: for non-JSON responses, store trimmed body as string
      // so that captures like `_body` work for text/plain, text/html, etc.
      if (body_parsed === undefined && bodyText.length > 0) {
        // Try JSON parse as fallback (some APIs omit content-type)
        try {
          body_parsed = JSON.parse(bodyText);
        } catch {
          body_parsed = bodyText.trim();
        }
      }

      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        headers[k] = v;
      });

      // Feed ratelimit-* headers back into the limiter so it can pause the
      // stream proactively when the window is nearly exhausted (TASK-81).
      if (opts.rate_limiter?.note) {
        const meta = parseRateLimitHeaders(headers);
        if (meta.remaining !== undefined || meta.reset !== undefined) {
          opts.rate_limiter.note(meta);
        }
      }

      const httpResp: HttpResponse = {
        status: response.status,
        headers,
        body: bodyText,
        body_parsed,
        duration_ms,
        network_retry_count: networkRetryCount,
      };
      if (_auditRecorder) {
        try { _auditRecorder({ request, response: httpResp, durationMs: duration_ms }); }
        catch { /* recorder is fire-and-forget */ }
      }
      return httpResp;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isNet = isTransientNetworkError(lastError);
      // TASK-144 path: dedicated network-retry budget with exp+jitter backoff.
      if (isNet && networkRetryCount < opts.network_retries) {
        const wait = networkBackoffMs(
          networkRetryCount,
          opts.network_retry_base_ms,
          opts.network_retry_max_delay_ms,
        );
        networkRetryCount++;
        await Bun.sleep(wait);
        continue;
      }
      // Legacy linear path (yaml suite.config.retries).
      if (networkAttempt < opts.retries) {
        networkAttempt++;
        await Bun.sleep(opts.retry_delay);
        continue;
      }
      if (_auditRecorder) {
        try { _auditRecorder({ request, durationMs: 0, error: lastError.message }); }
        catch { /* recorder is fire-and-forget */ }
      }
      throw lastError;
    }
  }
}

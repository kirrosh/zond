import type { HttpRequest, HttpResponse } from "./types.ts";
import { type RateLimiter, parseRetryAfter } from "./rate-limiter.ts";

export interface FetchOptions {
  timeout: number;
  retries: number;
  retry_delay: number;
  follow_redirects: boolean;
  rate_limiter?: RateLimiter;
  rate_limit_retries: number;
  rate_limit_max_delay_ms: number;
}

export const DEFAULT_FETCH_OPTIONS: FetchOptions = {
  timeout: 30000,
  retries: 0,
  retry_delay: 1000,
  follow_redirects: true,
  rate_limit_retries: 5,
  rate_limit_max_delay_ms: 30000,
};

export async function executeRequest(
  request: HttpRequest,
  options?: Partial<FetchOptions>,
): Promise<HttpResponse> {
  const opts = { ...DEFAULT_FETCH_OPTIONS, ...options };
  let lastError: Error | undefined;
  let networkAttempt = 0;
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

      return { status: response.status, headers, body: bodyText, body_parsed, duration_ms };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (networkAttempt < opts.retries) {
        networkAttempt++;
        await Bun.sleep(opts.retry_delay);
        continue;
      }
      throw lastError;
    }
  }
}

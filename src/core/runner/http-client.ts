import type { HttpRequest, HttpResponse } from "./types.ts";

export interface FetchOptions {
  timeout: number;
  retries: number;
  retry_delay: number;
  follow_redirects: boolean;
}

export const DEFAULT_FETCH_OPTIONS: FetchOptions = {
  timeout: 30000,
  retries: 0,
  retry_delay: 1000,
  follow_redirects: true,
};

export async function executeRequest(
  request: HttpRequest,
  options?: Partial<FetchOptions>,
): Promise<HttpResponse> {
  const opts = { ...DEFAULT_FETCH_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    if (attempt > 0) {
      await Bun.sleep(opts.retry_delay);
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
    }
  }

  throw lastError!;
}

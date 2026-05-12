import type { StoredStepResult } from "../../db/queries.ts";

export interface BuildCurlOptions {
  /** "redacted" — emit `Authorization: Bearer <REDACTED>` placeholder so the
   *  reader knows the original request was authenticated (ARV-106). "omit" —
   *  legacy behaviour. Defaults to "redacted". */
  authHeader?: "redacted" | "omit";
}

function isRemoteUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1" && host !== "0.0.0.0";
  } catch {
    return false;
  }
}

/** Single-quote-wrapped curl, safe-ish for shells. */
export function buildCurl(step: StoredStepResult, options: BuildCurlOptions = {}): string {
  const parts: string[] = ["curl"];
  const method = step.request_method?.toUpperCase();
  if (method && method !== "GET") {
    parts.push("-X", method);
  }
  const wantAuth = (options.authHeader ?? "redacted") === "redacted" && isRemoteUrl(step.request_url);
  if (wantAuth) {
    parts.push("-H", "'Authorization: Bearer <REDACTED — replace with your token>'");
  }
  if (step.request_body) {
    const escaped = step.request_body.replace(/'/g, `'\\''`);
    parts.push("-H", "'Content-Type: application/json'");
    parts.push("-d", `'${escaped}'`);
  }
  parts.push(`'${step.request_url ?? ""}'`);
  return parts.join(" ");
}

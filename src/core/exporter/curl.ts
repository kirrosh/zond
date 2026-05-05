import type { StoredStepResult } from "../../db/queries.ts";

/** Single-quote-wrapped curl, safe-ish for shells. */
export function buildCurl(step: StoredStepResult): string {
  const parts: string[] = ["curl"];
  const method = step.request_method?.toUpperCase();
  if (method && method !== "GET") {
    parts.push("-X", method);
  }
  if (step.request_body) {
    const escaped = step.request_body.replace(/'/g, `'\\''`);
    parts.push("-H", "'Content-Type: application/json'");
    parts.push("-d", `'${escaped}'`);
  }
  parts.push(`'${step.request_url ?? ""}'`);
  return parts.join(" ");
}

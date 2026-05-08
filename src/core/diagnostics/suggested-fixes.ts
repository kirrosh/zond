/**
 * TASK-29: actionable "Suggested fixes" surfaces for `zond db diagnose`.
 *
 * The base diagnose envelope already classifies failures and wires
 * agent_directive / recommended_action / env_issue. This layer adds two
 * concrete, fixable signals that the LLM agent can act on without a second
 * round-trip:
 *
 *   1. Placeholder path-params on 404s — when a 404 hits a URL that still
 *      contains literal example/placeholder values (`example`, all-zeros
 *      UUID, `your-…-here`, `00000000-…`, …), surface the exact path
 *      segment that's broken plus the variable name we'd expect (best-effort
 *      from the segment shape).
 *
 *   2. Untilled .env.yaml keys — read the API's .env.yaml and flag values
 *      that are empty, `<TODO>`, `example`, `null`, or look like
 *      placeholders (`replace-me`, `your-...`). These block CRUD sweeps
 *      silently — without them, the agent can't tell apart "value missing"
 *      from "value present and wrong".
 */
import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export type SuggestedFixKind =
  | "placeholder_path_param"
  | "unfilled_env_key";

export interface SuggestedFix {
  kind: SuggestedFixKind;
  /** When `kind=unfilled_env_key`: the key name. When `kind=placeholder_path_param`:
   *  the path segment that looks like a placeholder. */
  key: string;
  message: string;
  /** File path the user should edit (usually the API's .env.yaml). */
  source?: string;
  /** Optional one-line example of what to put there. */
  example?: string;
}

const PLACEHOLDER_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /^example$/i, reason: "literal `example`" },
  { re: /^placeholder$/i, reason: "literal `placeholder`" },
  { re: /^your-[\w-]+-here$/i, reason: "`your-…-here` placeholder" },
  { re: /^00000000-0000-0000-0000-0+(?:beef|dead|cafe|f00d|0+)$/i, reason: "all-zero / sentinel UUID" },
  { re: /^0+$/, reason: "all-zero numeric id" },
  { re: /^replace-me$/i, reason: "`replace-me` placeholder" },
];

const ENV_PLACEHOLDER_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /^<.*>$/, reason: "TODO / angle-bracket placeholder" },
  { re: /^example$/i, reason: "literal `example`" },
  { re: /^placeholder$/i, reason: "literal `placeholder`" },
  { re: /^your-[\w-]+-here$/i, reason: "`your-…-here` placeholder" },
  { re: /^replace-?me$/i, reason: "`replace-me` placeholder" },
  { re: /^<TODO>$/i, reason: "explicit TODO" },
];

/** Identify path segments that look like placeholders. Used on 404 URLs. */
export function detectPlaceholderSegments(url: string | null): Array<{ segment: string; reason: string }> {
  if (!url) return [];
  let pathname: string;
  try {
    pathname = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
  } catch {
    pathname = url;
  }
  const out: Array<{ segment: string; reason: string }> = [];
  for (const seg of pathname.split("/").filter(Boolean)) {
    for (const { re, reason } of PLACEHOLDER_PATTERNS) {
      if (re.test(seg)) {
        out.push({ segment: seg, reason });
        break;
      }
    }
  }
  return out;
}

/** Read .env.yaml and return keys whose value is empty/null/placeholder-shaped. */
export function findUnfilledEnvKeys(envFilePath: string | undefined): SuggestedFix[] {
  if (!envFilePath || !existsSync(envFilePath)) return [];
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(envFilePath, "utf-8"));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

  const out: SuggestedFix[] = [];
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    const reason = classifyEnvValue(val);
    if (reason) {
      out.push({
        kind: "unfilled_env_key",
        key,
        message: `\`${key}\` in ${envFilePath} is unfilled (${reason}). Set it to a real value before re-running.`,
        source: envFilePath,
      });
    }
  }
  return out;
}

function classifyEnvValue(val: unknown): string | null {
  if (val === null || val === undefined) return "null / missing";
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "") return "empty string";
    for (const { re, reason } of ENV_PLACEHOLDER_PATTERNS) {
      if (re.test(trimmed)) return reason;
    }
  }
  return null;
}

export interface BuildSuggestedFixesInput {
  failures: Array<{
    response_status: number | null;
    request_url: string | null;
    suite_name: string;
    test_name: string;
  }>;
  envFilePath?: string;
}

/**
 * Combine placeholder-detection across all 404 failures + env-yaml audit
 * into a single deduplicated list of fixes the agent should apply before
 * re-running.
 */
export function buildSuggestedFixes(input: BuildSuggestedFixesInput): SuggestedFix[] {
  const fixes: SuggestedFix[] = [];
  const seenSegments = new Set<string>();

  for (const f of input.failures) {
    if (f.response_status !== 404) continue;
    for (const ph of detectPlaceholderSegments(f.request_url)) {
      const dedupeKey = `seg:${ph.segment}`;
      if (seenSegments.has(dedupeKey)) continue;
      seenSegments.add(dedupeKey);
      fixes.push({
        kind: "placeholder_path_param",
        key: ph.segment,
        message:
          `404 on \`${f.request_url}\` — path segment \`${ph.segment}\` is a ${ph.reason}. ` +
          `Replace with a real id from the live API (e.g. \`zond discover --apply\`) ` +
          `or set the corresponding fixture in ${input.envFilePath ?? ".env.yaml"}.`,
        source: input.envFilePath,
      });
    }
  }

  fixes.push(...findUnfilledEnvKeys(input.envFilePath));
  return fixes;
}

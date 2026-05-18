import type {
  SecurityProbeResult,
  SecuritySeverity,
  SecurityVerdict,
} from "./types.ts";

/** ARV-245 (R-04/F16): percent-encode unsafe characters per path segment
 *  for paste-ready manual repro lines in the digest. Mirrors the encoding
 *  rules used by `cleanup --orphans` so the printed command works against
 *  the same APIs the probe targeted. */
function encodeDeletePathForRepro(deletePath: string): string {
  const SAFE = /[A-Za-z0-9._~!$&'()*+,;=:@-]/;
  return deletePath
    .split("/")
    .map((segment) => {
      if (segment.length === 0) return segment;
      let out = "";
      for (let i = 0; i < segment.length; i++) {
        const ch = segment.charAt(i);
        if (ch === "%" && /^[0-9A-Fa-f]{2}$/.test(segment.slice(i + 1, i + 3))) {
          out += segment.slice(i, i + 3);
          i += 2;
          continue;
        }
        out += SAFE.test(ch) ? ch : encodeURIComponent(ch);
      }
      return out;
    })
    .join("/");
}

/** TASK-154 §N: clip noisy payloads (some SSRF/CRLF/redirect strings are URL-
 *  encoded blobs > 60 chars). Keep the leading prefix users recognise plus an
 *  ellipsis, so the digest line stays readable. */
function truncatePayload(payload: string, max: number): string {
  if (payload.length <= max) return payload;
  return payload.slice(0, max - 1) + "…";
}

export function formatSecurityDigest(
  result: SecurityProbeResult,
  specPath: string,
): string {
  const lines: string[] = [];
  lines.push(`# zond probe-security digest`);
  lines.push("");
  lines.push(`Spec: \`${specPath}\``);
  lines.push(`Classes: ${result.classes.join(", ")}`);
  lines.push(`Endpoints scanned: ${result.totalEndpoints} · probed: ${result.specProbed}`);
  // ARV-140 AC#4: surface the cleanup-feasibility outcome up front so a
  // green run doesn't hide "we attacked 14 leak-prone POSTs anyway".
  if (result.cleanupFeasibility) {
    const f = result.cleanupFeasibility;
    if (f.skippedNoCleanup > 0) {
      lines.push(`Cleanup pre-flight: ${f.skippedNoCleanup} endpoint(s) skipped (no DELETE counterpart). Pass \`--allow-leaks\` to attack anyway.`);
    } else if (f.forcedNoCleanup > 0) {
      lines.push(`Cleanup pre-flight: ${f.forcedNoCleanup} endpoint(s) attacked despite no DELETE counterpart (--allow-leaks).`);
    }
    // ARV-153: surface action-verb POSTs we now attack without a DELETE
    // counterpart so green runs make the recall win visible.
    if (f.actionNoCleanupNeeded > 0) {
      lines.push(`Cleanup pre-flight: ${f.actionNoCleanupNeeded} action POST(s) attacked (no resource created — DELETE counterpart not needed).`);
    }
  }
  lines.push("");

  // Cleanup failures section is mandatory and goes FIRST when present —
  // round-4 dogfooding: a "green" run (HIGH=0) silently leaked DSN keys
  // and left renamed projects, because cleanup failures were buried in
  // per-verdict objects. Surface them prominently so a green probe is a
  // signal the org is clean, not just that nothing crashed.
  const cleanupFailures = result.verdicts.filter(v => v.cleanup?.error);
  if (cleanupFailures.length > 0) {
    lines.push(`## ⚠️ Cleanup failures (${cleanupFailures.length}) — manual remediation may be required`);
    lines.push("");
    for (const v of cleanupFailures) {
      lines.push(`- **${v.method} ${v.path}** — ${v.cleanup!.error}`);
      // ARV-245 (R-04/F16): paste-ready manual repro when we have a
      // deletePath. Auto-encode the path so operators dealing with
      // CRLF-poisoned ids (round-4 GitHub labels) don't have to remember
      // to percent-encode `\r`/`\n`/spaces themselves.
      const dp = v.cleanup?.deletePath;
      if (dp) {
        const encoded = encodeDeletePathForRepro(dp);
        const note = /[\r\n\t ]/.test(dp) ? " (note: id contains whitespace/CRLF — percent-encoded)" : "";
        lines.push(`  - Manual repro: \`zond request DELETE ${encoded} --api <name>\`${note}`);
      }
    }
    lines.push("");
  }

  const buckets: Record<SecuritySeverity, SecurityVerdict[]> = {
    high: [], medium: [], low: [], info: [], inconclusive: [], "inconclusive-baseline": [], ok: [], skipped: [],
  };
  for (const v of result.verdicts) buckets[v.severity].push(v);

  const ordered: SecuritySeverity[] = ["high", "inconclusive", "inconclusive-baseline", "medium", "low", "info", "ok", "skipped"];
  const titles: Record<SecuritySeverity, string> = {
    high: "🚨 HIGH — header-reflection / HTML reflection / 5xx",
    medium: "⚠️ MEDIUM — SSRF accept on endpoint declaring delivery (no OOB confirmation)",
    low: "🟡 LOW — storage observed, no dangerous-context reflection (verify manually)",
    info: "·  INFO — accepted, no reflection observed (sanitization signal only)",
    inconclusive: "❓ INCONCLUSIVE — could not classify",
    "inconclusive-baseline": "⚠️ INCONCLUSIVE-BASELINE — baseline 4xx, attacks not run",
    ok: "✅ OK — payloads rejected with 4xx",
    skipped: "⏭️ SKIPPED — no detected fields / no body",
  };
  for (const sev of ordered) {
    const list = buckets[sev];
    if (list.length === 0) continue;
    lines.push(`## ${titles[sev]} (${list.length})`);
    lines.push("");
    for (const v of list) {
      const cleanupTag = v.cleanup?.error ? " 🧹 cleanup-failure" : "";
      lines.push(`- **${v.method} ${v.path}**${cleanupTag} — ${v.summary}`);
      for (const f of v.findings) {
        // TASK-154 §N: surface the actual payload that triggered the finding
        // — without it the digest is useless for case-study writing (which
        // SSRF target? which CRLF shape?). Truncate long payloads so the
        // line stays readable.
        const payload = truncatePayload(f.payload, 60);
        lines.push(`  - \`${f.field}\` / ${f.class} [\`${payload}\`] → ${f.status} (${f.severity}) — ${f.reason}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

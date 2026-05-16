/**
 * Tally verdicts by severity into a caller-shaped bucket object and
 * format a one-line summary. Extracted from probe-mass-assignment and
 * probe-security CLI commands which had near-identical countBuckets +
 * Summary printers — they differ only in the severity vocabulary
 * ("medium" vs "inconclusive") and the label/order of the summary line.
 *
 * Generic over the bucket shape so each command keeps its own JSON-
 * envelope keys (camelCase) without rewriting the rest of the pipeline.
 */

export function tallyBySeverity<T extends object>(
  verdicts: ReadonlyArray<{ severity: string }>,
  mapping: ReadonlyArray<readonly [severity: string, bucket: keyof T & string]>,
  zero: T,
): T {
  const out: Record<string, number> = { ...(zero as Record<string, number>) };
  const lookup = new Map<string, string>(mapping);
  for (const v of verdicts) {
    const bucket = lookup.get(v.severity);
    if (bucket !== undefined && bucket in out) out[bucket]! += 1;
  }
  return out as T;
}

export function formatSummaryLine<T extends object>(
  counts: T,
  pairs: ReadonlyArray<readonly [label: string, bucket: keyof T & string]>,
): string {
  const indexed = counts as Record<string, number>;
  const parts = pairs.map(([label, key]) => `${label} ${indexed[key] ?? 0}`);
  return `Summary: ${parts.join(" · ")}`;
}

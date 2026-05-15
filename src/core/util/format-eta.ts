/**
 * ARV-249: human-readable duration formatter for ETA / progress lines.
 *
 * Distinct from `core/reporter/console.formatDuration`, which is geared to
 * per-step latencies (sub-second resolution, single unit). Here we drop
 * sub-second precision but emit two units once we cross a minute, so a
 * five-minute ETA reads `5m12s` instead of `5m 12s`.
 */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "?";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}m${rem}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

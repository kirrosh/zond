import { ALL_MIGRATIONS } from "./migrations/index.ts";
import type { Migration } from "./types.ts";

/**
 * Compare two semver strings.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);

  const [aMajor, aMinor, aPatch] = parse(a);
  const [bMajor, bMinor, bPatch] = parse(b);

  if (aMajor !== bMajor) return (aMajor ?? 0) - (bMajor ?? 0);
  if (aMinor !== bMinor) return (aMinor ?? 0) - (bMinor ?? 0);
  return (aPatch ?? 0) - (bPatch ?? 0);
}

/**
 * Return migrations that apply when upgrading FROM fromVersion.
 * A migration applies when its toVersion is greater than fromVersion.
 * Results are sorted in ascending version order.
 */
export function pendingMigrations(fromVersion: string): Migration[] {
  return ALL_MIGRATIONS.filter(
    (m) => compareSemver(m.toVersion, fromVersion) > 0,
  ).sort((a, b) => compareSemver(a.toVersion, b.toVersion));
}

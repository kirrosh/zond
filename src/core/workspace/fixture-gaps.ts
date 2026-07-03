/**
 * ARV-324: `.fixture-gaps.yaml` — per-API sidecar recording operations
 * that `prepare-fixtures`/`discover` already confirmed return a client
 * error (or an empty list) while hunting for fixture values — e.g. an
 * empty/under-provisioned test account.
 *
 * `checks run` runs as a separate process invocation and, without this
 * file, has no way to tell "known fixture gap" apart from "new backend
 * bug" — both would land on the same operation with
 * `recommended_action: report_backend_bug`. Loading this file lets the
 * classifier downgrade to `fix_fixture` instead (see
 * `core/classifier/recommended-action.ts`).
 *
 * Not the manifest (`.api-fixtures.yaml` stays spec-derived/read-only,
 * regenerated only by `refresh-api`) — this is runtime-observed state,
 * so it gets its own file, rewritten wholesale on every
 * discover/prepare-fixtures run so a since-fixed gap doesn't linger.
 */

import { join } from "node:path";
import { writeFile } from "node:fs/promises";

export interface FixtureGap {
  method: string;
  path: string;
  resource: string;
  var: string;
  reason: string;
}

const FILENAME = ".fixture-gaps.yaml";

export async function readFixtureGaps(apiDir: string): Promise<FixtureGap[]> {
  const file = Bun.file(join(apiDir, FILENAME));
  if (!(await file.exists())) return [];
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(await file.text());
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { gaps?: unknown }).gaps)) {
    return [];
  }
  return (parsed as { gaps: FixtureGap[] }).gaps;
}

export async function writeFixtureGaps(apiDir: string, gaps: FixtureGap[]): Promise<void> {
  const path = join(apiDir, FILENAME);
  const header = `# .fixture-gaps.yaml — auto-written by prepare-fixtures/discover (ARV-324)
#
# Operations that returned a client error (or an empty list) while zond
# hunted for a fixture value — a resource that's empty/inaccessible in
# the target API. Read by \`checks run\` so it doesn't relabel the same
# known gap as report_backend_bug. Safe to delete — regenerated on the
# next prepare-fixtures / discover run.
`;
  const { stringify } = await import("yaml");
  const body = stringify({ gaps }, { lineWidth: 0, defaultStringType: "PLAIN" });
  await writeFile(path, header + "\n" + body, "utf-8");
}

/** Key an operation the same way on both the write side (discover/bootstrap,
 *  always GET list-probes) and the read side (`CheckFinding.operation`). */
export function gapKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export function gapIndex(gaps: FixtureGap[]): Set<string> {
  return new Set(gaps.map((g) => gapKey(g.method, g.path)));
}

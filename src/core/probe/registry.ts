/**
 * Probe registry + boot-time validator (m-17 / ARV-49).
 *
 * The CLI bootstrap calls `bootstrapProbes()` exactly once — that
 * function imports each registered probe class and pushes it through
 * `registerProbe`, which throws if the contract from `types.ts` is
 * not fully implemented. Boot fails loud with a list of missing slots,
 * so adding a new probe class without --dry-run / --report support is
 * impossible (replaces the conventions-then-drift status quo that
 * produced F1-15 / F2-15 / F3-15 in feedback round 15).
 */
import type { Probe, ProbeFlags } from "./types.ts";

const REQUIRED_METHODS: Array<keyof Probe> = ["dryRun", "run", "report"];
const REQUIRED_FLAGS: Array<keyof ProbeFlags> = [
  "api",
  "tag",
  "include",
  "exclude",
  "dryRun",
  "listTags",
  "json",
  "output",
  "report",
];

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Pure validator — used by both `registerProbe` and the contract test
 *  in `tests/contracts/probe-interface.test.ts`. */
export function validateProbe(p: unknown): ValidationResult {
  const errors: string[] = [];
  if (p === null || typeof p !== "object") {
    return { ok: false, errors: ["Probe is not an object"] };
  }
  const probe = p as Partial<Probe>;
  const label = probe.name ?? "<anonymous>";
  if (typeof probe.name !== "string" || probe.name.length === 0) {
    errors.push("Probe is missing required field name");
  }
  if (typeof probe.description !== "string" || probe.description.length === 0) {
    errors.push(`Probe "${label}" is missing required field description`);
  }
  for (const m of REQUIRED_METHODS) {
    if (typeof (probe as Record<string, unknown>)[m] !== "function") {
      errors.push(`Probe "${label}" is missing required method ${m}`);
    }
  }
  if (probe.commonFlags === undefined || probe.commonFlags === null || typeof probe.commonFlags !== "object") {
    errors.push(`Probe "${label}" is missing required field commonFlags`);
  } else {
    const flags = probe.commonFlags as unknown as Record<string, unknown>;
    for (const f of REQUIRED_FLAGS) {
      const v = flags[f as string];
      if (typeof v !== "boolean") {
        errors.push(`Probe "${label}" commonFlags is missing slot ${f} (must be boolean)`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

const PROBES = new Map<string, Probe>();

export function registerProbe(probe: Probe): void {
  const r = validateProbe(probe);
  if (!r.ok) {
    throw new Error(
      `Invalid probe registration:\n  - ${r.errors.join("\n  - ")}`,
    );
  }
  if (PROBES.has(probe.name)) {
    throw new Error(`Probe "${probe.name}" is already registered`);
  }
  PROBES.set(probe.name, probe);
}

export function listProbes(): readonly Probe[] {
  return Array.from(PROBES.values());
}

export function getProbe(name: string): Probe | undefined {
  return PROBES.get(name);
}

/** Test helper — wipes the registry between unit tests. NOT exported
 *  through `index.ts`; tests import this module directly. */
export function clearProbes(): void {
  PROBES.clear();
}

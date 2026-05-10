/**
 * Probe contract validator (m-17 / ARV-49 AC#4).
 *
 * Boot-time invariant: every Probe registered through
 * `bootstrapProbes()` must satisfy the TS contract from
 * `src/core/probe/types.ts`. This test exercises the validator
 * directly with mock Probe shapes — both the missing-slot case
 * (registry refuses) and the well-formed case (registry accepts) — so
 * the contract gets locked in independently of the actual probe
 * implementations.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import {
  validateProbe,
  registerProbe,
  listProbes,
  clearProbes,
} from "../../src/core/probe/registry.ts";
import { resetBootstrap, bootstrapProbes } from "../../src/core/probe/bootstrap.ts";
import type { Probe, ProbeFlags } from "../../src/core/probe/types.ts";

const FULL_FLAGS: ProbeFlags = {
  api: true,
  tag: true,
  include: true,
  exclude: true,
  dryRun: true,
  listTags: true,
  json: true,
  output: true,
  report: true,
};

function makeProbe(overrides: Partial<Probe> = {}): Probe {
  const base: Probe = {
    name: "fake",
    description: "fake probe for contract test",
    commonFlags: { ...FULL_FLAGS },
    async dryRun() { return []; },
    async run() { return { endpoints: [], summary: { totalEndpoints: 0, probed: 0, by_status: { ok: 0, high: 0, low: 0, inconclusive: 0, skipped: 0 } }, warnings: [] }; },
    report() { return ""; },
  };
  return { ...base, ...overrides };
}

describe("Probe contract", () => {
  beforeEach(() => {
    resetBootstrap();
    clearProbes();
  });

  test("rejects probe missing dryRun method", () => {
    const incomplete = makeProbe();
    delete (incomplete as Partial<Probe>).dryRun;
    const r = validateProbe(incomplete);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("missing required method dryRun"))).toBe(true);
  });

  test("rejects probe missing report method", () => {
    const incomplete = makeProbe();
    delete (incomplete as Partial<Probe>).report;
    const r = validateProbe(incomplete);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("missing required method report"))).toBe(true);
  });

  test("rejects probe missing run method", () => {
    const incomplete = makeProbe();
    delete (incomplete as Partial<Probe>).run;
    const r = validateProbe(incomplete);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("missing required method run"))).toBe(true);
  });

  test("rejects probe missing a commonFlags slot", () => {
    const incomplete = makeProbe();
    const flags = { ...FULL_FLAGS } as Partial<ProbeFlags>;
    delete flags.dryRun;
    (incomplete as { commonFlags: ProbeFlags }).commonFlags = flags as ProbeFlags;
    const r = validateProbe(incomplete);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("commonFlags is missing slot dryRun"))).toBe(true);
  });

  test("rejects probe with empty name", () => {
    const incomplete = makeProbe({ name: "" });
    const r = validateProbe(incomplete);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("missing required field name"))).toBe(true);
  });

  test("registerProbe throws on invalid input", () => {
    const incomplete = makeProbe();
    delete (incomplete as Partial<Probe>).report;
    expect(() => registerProbe(incomplete)).toThrow(/missing required method report/);
  });

  test("registerProbe accepts a complete probe", () => {
    expect(() => registerProbe(makeProbe())).not.toThrow();
    expect(listProbes().map((p) => p.name)).toEqual(["fake"]);
  });

  test("registerProbe rejects duplicate names", () => {
    registerProbe(makeProbe());
    expect(() => registerProbe(makeProbe())).toThrow(/already registered/);
  });

  test("bootstrapProbes registers static, mass-assignment, security", () => {
    bootstrapProbes();
    const names = listProbes().map((p) => p.name).sort();
    expect(names).toEqual(["mass-assignment", "security", "static"]);
  });

  test("each registered probe implements the full commonFlags slot table", () => {
    bootstrapProbes();
    for (const p of listProbes()) {
      const r = validateProbe(p);
      expect(r.ok, `probe ${p.name} failed validation: ${r.errors.join(", ")}`).toBe(true);
    }
  });
});

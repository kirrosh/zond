/**
 * Probe CLI compliance contract (m-17 / ARV-58).
 *
 * Table-driven over `core/probe/registry.ts`: for every registered
 * Probe class we exercise four end-to-end invocations through the
 * compiled CLI and verify the contract from m-17 holds:
 *
 *   1. `--help` exposes every flag the probe declares in commonFlags.
 *   2. `--list-tags --json` (when listTags is declared) returns an
 *      envelope with `data.tags: string[]`.
 *   3. `--dry-run --json` (when dryRun is declared) returns the
 *      probeDryRun shape — `data.endpoints[]` with planned/skipped
 *      enum, no severity bucket (closes F1-15).
 *   4. `--report json --dry-run --json` envelope NEVER carries
 *      `data.digest.stdout` (closes F3-15 regression channel).
 *
 * AC#6 — adding a new Probe class without matching contract — is
 * already covered at the boot layer in `probe-interface.test.ts`.
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  JsonEnvelopeSchema,
  ProbeDryRunDataSchema,
} from "../../src/cli/json-schemas.ts";
import { bootstrapProbes } from "../../src/core/probe/bootstrap.ts";
import { listProbes, clearProbes } from "../../src/core/probe/registry.ts";
import { resetBootstrap } from "../../src/core/probe/bootstrap.ts";
import type { Probe } from "../../src/core/probe/types.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const PETSTORE = resolve(REPO_ROOT, "tests/fixtures/petstore-simple.json");
const PREBUILT = resolve(REPO_ROOT, "dist/zond");
const ENTRY_TS = resolve(REPO_ROOT, "src/cli/index.ts");

function runCli(argv: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const cmd = existsSync(PREBUILT) ? [PREBUILT, ...argv] : ["bun", "run", ENTRY_TS, ...argv];
  const proc = Bun.spawnSync({
    cmd,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ZOND_API: "", HOME: cwd },
  });
  return {
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
    exitCode: proc.exitCode ?? -1,
  };
}

function extractEnvelope(stdout: string): unknown | null {
  const start = stdout.indexOf("{");
  if (start === -1) return null;
  try { return JSON.parse(stdout.slice(start)); } catch { return null; }
}

/**
 * Per-probe argv builder. Probes have different positional arguments
 * (`probe security <classes>` requires a classes arg, `probe static`
 * needs `--output` to know where to write). The builder takes the
 * sub-flags we want to exercise (--dry-run, --json, …) and produces a
 * full argv slice.
 */
const PROBE_CLI: Record<string, { argv: (sub: string[], outDir: string) => string[]; helpArgv: string[] }> = {
  static: {
    argv: (sub, outDir) => ["probe", "static", PETSTORE, "--output", join(outDir, "probes"), ...sub],
    helpArgv: ["probe", "static", "--help"],
  },
  "mass-assignment": {
    argv: (sub) => ["probe", "mass-assignment", PETSTORE, ...sub],
    helpArgv: ["probe", "mass-assignment", "--help"],
  },
  security: {
    argv: (sub) => ["probe", "security", "ssrf", PETSTORE, ...sub],
    helpArgv: ["probe", "security", "--help"],
  },
};

/** CLI flag names by Probe.commonFlags slot. Keep in sync with
 *  probe.ts when new flags land. */
const FLAG_TO_CLI: Record<string, string> = {
  api: "--api",
  tag: "--tag",
  include: "--include",
  exclude: "--exclude",
  dryRun: "--dry-run",
  listTags: "--list-tags",
  json: "--json",
  output: "--output",
  report: "--report",
};

describe("Probe CLI compliance (ARV-58)", () => {
  // The bootstrap is idempotent — calling it repeatedly under bun test
  // is safe (see resetBootstrap in tests/contracts/probe-interface.test.ts
  // for the test-isolation path).
  bootstrapProbes();
  const probes = listProbes();

  test("registry has at least one probe (sanity)", () => {
    expect(probes.length).toBeGreaterThanOrEqual(1);
  });

  for (const probe of probes) {
    const cli = PROBE_CLI[probe.name];
    if (!cli) {
      // A probe without an entry here is a registry/CLI mismatch — fail
      // loud so adding a new Probe class forces a CLI binding.
      test(`${probe.name}: PROBE_CLI entry exists`, () => {
        throw new Error(`Probe "${probe.name}" is registered but not wired into PROBE_CLI in this test file.`);
      });
      continue;
    }

    // AC#2 — --help advertises every declared flag.
    test(`${probe.name}: --help advertises every declared commonFlag`, () => {
      const dir = mkdtempSync(join(tmpdir(), `arv58-${probe.name}-`));
      try {
        const r = runCli(cli.helpArgv, dir);
        const help = r.stdout + "\n" + r.stderr;
        const declared = Object.entries(probe.commonFlags).filter(([, v]) => v === true) as Array<[keyof Probe["commonFlags"], true]>;
        const missing = declared
          .map(([slot]) => FLAG_TO_CLI[slot as string]!)
          .filter((flag) => !help.includes(flag));
        expect(missing, `${probe.name} --help missing flags: ${missing.join(", ")}`).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 30000);

    // AC#3 — --list-tags --json envelope carries `data.tags: string[]`.
    if (probe.commonFlags.listTags) {
      test(`${probe.name}: --list-tags --json returns {tags: string[]}`, () => {
        const dir = mkdtempSync(join(tmpdir(), `arv58-${probe.name}-`));
        try {
          const r = runCli(cli.argv(["--list-tags", "--json"], dir), dir);
          const env = extractEnvelope(r.stdout);
          expect(env, `${probe.name} --list-tags emitted no envelope`).not.toBeNull();
          const validated = JsonEnvelopeSchema.safeParse(env);
          expect(validated.success).toBe(true);
          if (validated.success && validated.data.ok) {
            const data = validated.data.data as { tags?: unknown };
            expect(Array.isArray(data.tags), `${probe.name} --list-tags data.tags is not array: ${JSON.stringify(data)}`).toBe(true);
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }, 30000);
    }

    // AC#4 — --dry-run --json envelope matches probeDryRun schema and
    // does not carry severity (F1-15).
    if (probe.commonFlags.dryRun) {
      test(`${probe.name}: --dry-run --json returns probeDryRun shape (closes F1-15)`, () => {
        const dir = mkdtempSync(join(tmpdir(), `arv58-${probe.name}-`));
        try {
          const r = runCli(cli.argv(["--dry-run", "--json"], dir), dir);
          const env = extractEnvelope(r.stdout);
          expect(env, `${probe.name} --dry-run emitted no envelope`).not.toBeNull();
          const validated = JsonEnvelopeSchema.safeParse(env);
          expect(validated.success).toBe(true);
          if (validated.success && validated.data.ok) {
            const dryRunValid = ProbeDryRunDataSchema.safeParse(validated.data.data);
            expect(
              dryRunValid.success,
              dryRunValid.success ? "" : `${probe.name} dry-run data shape mismatch: ${JSON.stringify(dryRunValid.error.issues)}`,
            ).toBe(true);
            // F1-15 explicit check: no severity bucket leaks through.
            const data = validated.data.data as Record<string, unknown>;
            expect(data["severity"], `${probe.name} dry-run leaked a severity bucket — F1-15 regression`).toBeUndefined();
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }, 30000);
    }

    // AC#5 — envelopes never carry `data.digest.stdout` (closes F3-15
    // regression channel). Exercised on the dry-run path because it's
    // network-free; the live-run path is locked separately by
    // tests/contracts/probe-report-json.test.ts.
    if (probe.commonFlags.dryRun || probe.commonFlags.json) {
      test(`${probe.name}: envelope does NOT carry data.digest.stdout (closes F3-15)`, () => {
        const dir = mkdtempSync(join(tmpdir(), `arv58-${probe.name}-`));
        try {
          const sub = probe.commonFlags.dryRun ? ["--dry-run", "--json"] : ["--json"];
          const r = runCli(cli.argv(sub, dir), dir);
          const env = extractEnvelope(r.stdout);
          expect(env).not.toBeNull();
          const data = (env as { data?: unknown })?.data;
          if (data && typeof data === "object") {
            const digest = (data as { digest?: { stdout?: unknown } }).digest;
            expect(digest?.stdout, `${probe.name} envelope leaked data.digest.stdout — F3-15 regression`).toBeUndefined();
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }, 30000);
    }
  }

  // AC#6 sanity — bootstrap'd registry contains exactly the probes we
  // expect, in CLI-bound order. A new probe class without a PROBE_CLI
  // entry fails earlier; this is the symmetric check.
  test("registry exposes only the probes we know how to test", () => {
    const names = probes.map((p) => p.name).sort();
    expect(names).toEqual(["mass-assignment", "security", "static"]);
  });

  // Test-isolation hygiene: previous suites that called clearProbes()
  // (e.g. probe-interface.test.ts) reset the registry; we must
  // re-bootstrap before exiting so independent test runs see a stable
  // state regardless of file order.
  test("bootstrap survives clearProbes (cleanup hook)", () => {
    clearProbes();
    // bootstrapProbes() is idempotent — re-running after `clearProbes`
    // is a no-op unless we reset the singleton flag.
    resetBootstrap();
    bootstrapProbes();
    expect(listProbes().length).toBeGreaterThan(0);
  });
});

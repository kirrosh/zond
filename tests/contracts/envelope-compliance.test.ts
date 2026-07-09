/**
 * Build-time envelope contract (m-17 / ARV-57).
 *
 * Smoke-runs every `--json`-emitting CLI command from a clean tmp cwd
 * and validates the produced envelope against the published
 * `JsonEnvelopeSchema` (`docs/json-schema/envelope.schema.json`).
 * Per-command refinements are validated against their dedicated
 * `data` schemas (probe-dry-run, probe-run, checks-run).
 *
 * TASK-184 codified the envelope as a *convention*; m-17 turns it
 * into a contract — adding a new `--json` command without going
 * through `printJson`/`jsonOk`/`jsonError` will fail this test in CI.
 *
 * Coverage policy:
 *   - SMOKE      → invocation runs and envelope is validated.
 *   - ALLOW_LIST → invocation requires elaborate setup (live HTTP,
 *                  multi-step DB state) and is documented with a
 *                  rationale. We still grep the source to confirm
 *                  the command goes through one of the canonical
 *                  envelope helpers.
 *
 * Hard floor: ≥ 80% of envelope-emitting commands run live (AC#4).
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  JsonEnvelopeSchema,
  ProbeDryRunDataSchema,
  ChecksRunDataSchema,
} from "../../src/cli/json-schemas.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const PETSTORE = resolve(REPO_ROOT, "tests/fixtures/petstore-simple.json");

interface SmokeEntry {
  /** Source command file under src/cli/commands/. Used for coverage tracking. */
  source: string;
  /** Argv passed to `zond`. */
  argv: string[];
  /** Optional refinement schema applied to envelope.data when ok:true. */
  dataSchema?: typeof ProbeDryRunDataSchema;
  /** When true, accept either ok:true or ok:false envelopes — the
   *  command is being smoke-tested for *envelope shape*, not behavior. */
  allowError?: boolean;
}

/**
 * Curated smoke table. Each entry runs `bun src/cli/index.ts <argv>`
 * in a fresh tmp cwd. We accept any well-formed envelope (success or
 * error) — the test answers "does this command emit a valid envelope?"
 * not "does the smoke scenario succeed?".
 */
const SMOKE: SmokeEntry[] = [
  { source: "describe.ts", argv: ["describe", PETSTORE, "--json"] },
  { source: "catalog.ts", argv: ["catalog", PETSTORE, "--json"] },
  { source: "check.ts", argv: ["check", "spec", PETSTORE, "--json"] },
  { source: "checks.ts", argv: ["checks", "list", "--json"] },
  { source: "doctor.ts", argv: ["doctor", "--json"], allowError: true },
  { source: "session.ts", argv: ["session", "list", "--json"] },
  { source: "coverage.ts", argv: ["coverage", "--json"], allowError: true },
  { source: "cleanup.ts", argv: ["cleanup", "--orphans", "--api", "default", "--json"], allowError: true },
  { source: "clean.ts", argv: ["clean", "--json"], allowError: true },
  { source: "reference.ts", argv: ["reference", "random-helpers", "--json"] },
  { source: "remove-api.ts", argv: ["remove", "api", "nonexistent", "--json"], allowError: true },
  { source: "use.ts", argv: ["use", "nonexistent", "--json"], allowError: true },
  { source: "ci-init.ts", argv: ["ci", "init", "--github", "--json"] },
  { source: "report.ts", argv: ["report", "export", "1", "--json"], allowError: true },
  { source: "report-bundle.ts", argv: ["report", "bundle", "1..1", "--json"], allowError: true },
  { source: "db.ts", argv: ["db", "collections", "--json"] },
  { source: "request.ts", argv: ["request", "GET", "http://127.0.0.1:1/x", "--timeout", "500", "--json"], allowError: true },
  { source: "add-api.ts", argv: ["add", "api", "smoke-api", "--spec", PETSTORE, "--json"], allowError: true },
  {
    source: "probe-static.ts",
    argv: ["probe", "static", PETSTORE, "--output", "/tmp/probe-static-arv57", "--json"],
  },
  {
    source: "probe-mass-assignment.ts",
    argv: ["probe", "mass-assignment", PETSTORE, "--dry-run", "--json"],
    dataSchema: ProbeDryRunDataSchema,
  },
  {
    source: "probe-security.ts",
    argv: ["probe", "security", "ssrf", PETSTORE, "--dry-run", "--json"],
    dataSchema: ProbeDryRunDataSchema,
  },
  { source: "generate.ts", argv: ["generate", PETSTORE, "--output", "/tmp/gen-arv57", "--json"] },
];

/** ALLOW_LIST: commands whose smoke scenario needs elaborate setup
 *  (live HTTP, prior `zond run` for `db diagnose`, etc.). We still
 *  enforce that the source file goes through `printJson`/`jsonOk`. */
const ALLOW_LIST: Array<{ source: string; reason: string }> = [
  { source: "run.ts", reason: "Needs a YAML suite + live HTTP — contract-tested via tests/runner/* fixtures instead." },
  { source: "init/index.ts", reason: "Interactive scaffolding — emits envelopes only on the non-interactive path; covered by tests/cli/init.test.ts." },
  { source: "prepare-fixtures.ts", reason: "Aborts with `Error: API not found` (printed by withApiContext middleware before the action) on missing-api; envelope path covered by tests/cli/prepare-fixtures.test.ts." },
  { source: "audit.ts", reason: "Same withApiContext early-exit; envelope path covered by tests/cli/audit-orchestration.test.ts." },
  { source: "refresh-api.ts", reason: "Same withApiContext early-exit; envelope path covered by tests/cli/refresh-api.test.ts." },
  { source: "schema-from-runs.ts", reason: "ARV-175: needs a spec + a persisted run in the DB to reach the envelope path (rejects with a spec/run error before that). Core logic covered by tests/core/spec/{infer-schema,schema-from-runs}.test.ts." },
  { source: "probe.ts", reason: "ARV-119: registration umbrella for `probe static|mass-assignment|security`. The envelope helpers in this file fire only on input-flag errors (resolveOutput rejecting an unknown --report). The live command-level envelopes are emitted by probe-mass-assignment.ts / probe-security.ts, both already in SMOKE." },
  { source: "api/annotate/index.ts", reason: "ARV-187: agent-augmented workflow (zond emits prompts; agent answers; zond applies). Smoke entry would need a multi-step subcommand orchestration with a fixture YAML response. Per-parser correctness covered by tests/cli/annotate.test.ts." },
  { source: "fixtures.ts", reason: "ARV-195: needs a registered API + spec.json on disk to exercise the envelope path (resolveApiContext rejects missing collections before the action runs). Pure helpers (extractUrlFromCurl, extractFixturesFromPath) covered by tests/cli/fixtures.test.ts." },
  { source: "secrets.ts", reason: "ARV-377: needs a registered API with a base_dir to reach the envelope path (resolveApiCollection rejects missing collections before the write). Never echoes the secret value; covered by tests/cli/secrets.test.ts." },
];

/** Use the pre-compiled binary when it exists (much faster — 10× over
 *  cold `bun run src/cli/index.ts` per invocation). Build it once per
 *  CI run with `bun run build`; falls back to `bun run` otherwise. */
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

function extractEnvelope(stdout: string): { ok: true; value: unknown } | { ok: false; error: string } {
  // Some commands print non-JSON banners before the envelope (mutation
  // banner, etc.). Find the first `{` and parse from there.
  const start = stdout.indexOf("{");
  if (start === -1) return { ok: false, error: `no JSON in stdout:\n${stdout.slice(0, 500)}` };
  const tail = stdout.slice(start);
  try {
    return { ok: true, value: JSON.parse(tail) };
  } catch (err) {
    return { ok: false, error: `JSON.parse failed: ${(err as Error).message}\n${tail.slice(0, 500)}` };
  }
}

describe("envelope-compliance contract (ARV-57)", () => {
  // AC#1 + AC#3: every smoke entry produces a JsonEnvelopeSchema-valid
  // envelope on stdout. Timeout is generous because each invocation
  // spawns a fresh `bun run src/cli/index.ts` subprocess.
  for (const entry of SMOKE) {
    test(`${entry.source}: ${entry.argv.join(" ")}`, () => {
      const dir = mkdtempSync(join(tmpdir(), "zond-arv57-"));
      try {
        const r = runCli(entry.argv, dir);
        if (process.env.ZOND_ARV57_DEBUG) {
          process.stderr.write(`[arv57] ${entry.source} exit=${r.exitCode} stdout=${r.stdout.slice(0, 200)}\n`);
        }
        const parsed = extractEnvelope(r.stdout);
        if (!parsed.ok) {
          throw new Error(
            `${entry.source}: expected JSON envelope on stdout (exit ${r.exitCode}); ${parsed.error}\nstderr: ${r.stderr.slice(0, 300)}`,
          );
        }
        const validated = JsonEnvelopeSchema.safeParse(parsed.value);
        expect(
          validated.success,
          validated.success ? "" : `${entry.source}: envelope mismatch — ${JSON.stringify(validated.error.issues)}`,
        ).toBe(true);

        const env = validated.success ? validated.data : null;
        if (env && !entry.allowError) {
          // Smoke should succeed unless explicitly allowed to error.
          expect(env.ok, `${entry.source}: expected ok:true (smoke not flagged allowError); errors=${JSON.stringify(env.errors)}`).toBe(true);
        }

        // AC#1 refinement: per-command data shape (probe dry-run / run,
        // checks-run, etc.) — only when we have an ok envelope and a
        // schema is wired.
        if (entry.dataSchema && env && env.ok) {
          const dataParsed = entry.dataSchema.safeParse(env.data);
          expect(
            dataParsed.success,
            dataParsed.success ? "" : `${entry.source}: data schema mismatch — ${JSON.stringify(dataParsed.error.issues)}`,
          ).toBe(true);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 30000);
  }

  // Inventory of envelope-emitting command files. A file qualifies if
  // it (a) imports/uses one of the canonical envelope helpers AND (b)
  // registers a CLI command via `.command(` (excludes pure helper
  // modules like bootstrap.ts / discover.ts that other commands
  // delegate into).
  function envelopeEmittingFiles(): string[] {
    const cmdDir = resolve(REPO_ROOT, "src/cli/commands");
    const files = readdirSync(cmdDir, { recursive: true })
      .map((f) => String(f))
      .filter((f) => f.endsWith(".ts"));
    const out: string[] = [];
    for (const f of files) {
      const full = resolve(cmdDir, f);
      if (!existsSync(full)) continue;
      const src = readFileSync(full, "utf-8");
      const hasEnvelope = /(printJson|jsonOk|jsonError|writeEnvelope|withEnvelope)\b/.test(src);
      const hasRegistration = /\.command\s*\(/.test(src);
      if (hasEnvelope && hasRegistration) out.push(f);
    }
    return out;
  }

  // AC#2: every envelope-emitting command file is either in SMOKE or
  // explicitly allow-listed; otherwise the test fails with a pointer
  // to docs/json-schema/.
  test("every envelope-emitting command is in SMOKE or ALLOW_LIST (AC#2)", () => {
    const files = envelopeEmittingFiles();
    const covered = new Set([
      ...SMOKE.map((s) => s.source),
      ...ALLOW_LIST.map((a) => a.source),
    ]);
    const missing = files.filter((f) => !covered.has(f));
    expect(
      missing,
      missing.length === 0
        ? ""
        : `Commands emit a --json envelope but are neither in SMOKE nor ALLOW_LIST: ${missing.join(", ")}.\n` +
            `Add a SMOKE entry to tests/contracts/envelope-compliance.test.ts (preferred) or document the omission in ALLOW_LIST.`,
    ).toEqual([]);
  });

  // AC#4: ≥80% of envelope-emitting commands run live (i.e. are in SMOKE,
  // not just ALLOW_LIST).
  test("≥80% of envelope-emitting commands run live (AC#4)", () => {
    const total = envelopeEmittingFiles().length;
    const live = SMOKE.length;
    const pct = total === 0 ? 1 : live / total;
    expect(
      pct,
      `Live coverage ${(pct * 100).toFixed(1)}% (${live}/${total}) — below the 80% floor. Move entries from ALLOW_LIST to SMOKE.`,
    ).toBeGreaterThanOrEqual(0.8);
  });

  // ChecksRunDataSchema: not exercised by smoke (needs a live API), but
  // we lock it in via the refined schemas already covered in tests/
  // contracts/probe-dry-run-shape.test.ts. Keep the import live so the
  // schema reference doesn't bit-rot.
  test("checks-run data schema is referenced (anti-rot)", () => {
    expect(ChecksRunDataSchema).toBeDefined();
  });
});

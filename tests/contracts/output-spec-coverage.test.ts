/**
 * Build-time OutputSpec coverage (ARV-120 / m-19).
 *
 * Extends ARV-57 (envelope shape) with a *structural* contract: every
 * leaf CLI command that exposes `--json` or `--report` MUST be wired
 * through `core/output`'s OutputSpec policy — or be explicitly listed
 * in `LEGACY_ALLOW_LIST` with a rationale (pre-m-19 commands not yet
 * migrated). New `--json`/`--report` commands added outside that list
 * fail CI with a pointer here.
 *
 * Companion check: every OutputSpec format with `envelopeWrap: true`
 * declares an `envelopeSchemaFile`, and the referenced file exists
 * under `docs/json-schema/`. Renaming or deleting a schema without
 * updating the spec (or vice-versa) breaks this test.
 *
 * The envelope *runtime* shape is still validated by
 * `tests/contracts/envelope-compliance.test.ts` (ARV-57); this test
 * only guards the *declaration*.
 */
import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";

import { buildProgram } from "../../src/cli/program.ts";
import type { OutputSpec } from "../../src/core/output/index.ts";
import { CHECKS_OUTPUT_SPEC } from "../../src/cli/commands/checks.ts";
import { PROBE_OUTPUT_SPEC } from "../../src/cli/commands/probe.ts";
import { RUN_OUTPUT_SPEC } from "../../src/cli/commands/run.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const SCHEMA_DIR = resolve(REPO_ROOT, "docs", "json-schema");

/**
 * Fully-qualified command path → OutputSpec wired into the action.
 * Adding a new entry here is how a command opts *in* to the spec
 * contract. The opposite of LEGACY_ALLOW_LIST.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SPEC_REGISTRY: Record<string, OutputSpec<any>> = {
  "run": RUN_OUTPUT_SPEC,
  "checks run": CHECKS_OUTPUT_SPEC,
  "probe mass-assignment": PROBE_OUTPUT_SPEC,
  "probe security": PROBE_OUTPUT_SPEC,
  "probe webhooks": PROBE_OUTPUT_SPEC,
};

/**
 * Pre-m-19 commands that emit `--json` envelopes via `printJson` /
 * `jsonOk` directly, without going through `core/output`. Each entry
 * names the migration ticket so the list can be drained over time.
 *
 * Adding a new --json command here is a hard signal that the migration
 * is still incomplete; new commands should pick an OutputSpec instead.
 */
const LEGACY_ALLOW_LIST: Record<string, string> = {
  "add api": "pre-m-19: --json envelope via printJson; OutputSpec migration not scheduled.",
  "audit": "pre-m-19: orchestration command — emits envelopes via jsonOk; migration not scheduled.",
  "catalog": "pre-m-19: --json envelope via printJson.",
  "check spec": "pre-m-19: --json envelope via printJson.",
  "check tests": "pre-m-19: --json envelope via printJson.",
  "lint": "ARV-255 alias of `check spec` (m-21 spec-lint separation). Inherits its envelope; OutputSpec migration not separately scheduled.",
  "checks list": "pre-m-19: --json envelope via printJson (checks run is migrated).",
  "ci init": "pre-m-19: --json envelope via printJson.",
  "clean": "pre-m-19: --json envelope via printJson.",
  "cleanup": "pre-m-19: --json envelope via printJson.",
  "coverage": "pre-m-19: --json envelope via printJson; rich --format alias.",
  "db collections": "pre-m-19: --json envelope via printJson.",
  "db compare": "pre-m-19: --json envelope via printJson.",
  "db diagnose": "pre-m-19: --json envelope via printJson.",
  "db run": "pre-m-19: --json envelope via printJson.",
  "db runs": "pre-m-19: --json envelope via printJson.",
  "describe": "pre-m-19: --json envelope via printJson.",
  "doctor": "pre-m-19: --json envelope via printJson.",
  "generate": "pre-m-19: --json envelope via printJson.",
  "init": "pre-m-19: interactive scaffold; --json only on the non-interactive path.",
  "prepare-fixtures": "pre-m-19: --json envelope via printJson.",
  "probe static": "pre-m-19: --output is a directory (probe-suite filesystem layout), not output-format. OutputSpec does not model this; skip.",
  "reference random-helpers": "pre-m-19: --json envelope via printJson.",
  "refresh-api": "pre-m-19: --json envelope via printJson.",
  "remove api": "pre-m-19: --json envelope via printJson.",
  "report bundle": "pre-m-19: --json envelope via printJson.",
  "report export": "pre-m-19: --json envelope via printJson.",
  "request": "pre-m-19: --json envelope via printJson.",
  "session end": "pre-m-19: --json envelope via printJson.",
  "session list": "pre-m-19: --json envelope via printJson.",
  "session start": "pre-m-19: --json envelope via printJson.",
  "session status": "pre-m-19: --json envelope via printJson.",
  "use": "pre-m-19: --json envelope via printJson.",
  "api annotate dump": "ARV-187: emits per-resource spec slices for the agent (no prompts inside zond); --json wraps in envelope. OutputSpec migration not scheduled.",
  "api annotate apply": "ARV-187: applies the agent's YAML responses to .api-resources.local.yaml; --json wraps the merge summary. OutputSpec migration not scheduled.",
  "api annotate auto": "ARV-262: heuristic inference (pagination/lifecycle/idempotency) writes the overlay without an agent; --json wraps the inference summary. OutputSpec migration not scheduled.",
  "fixtures add": "ARV-195: --json envelope via printJson. OutputSpec migration not scheduled — single-shape command (writes + validations).",
  "fixtures import": "ARV-195: --json envelope via printJson. OutputSpec migration not scheduled — single-shape command (writes + source).",
  "config validate": "ARV-283: --json envelope via printJson (severity config load+validate result). OutputSpec migration not scheduled — single-shape command.",
};

interface LeafEntry {
  path: string;
  hasJson: boolean;
  hasReport: boolean;
}

function collectLeaves(program: Command): LeafEntry[] {
  const out: LeafEntry[] = [];
  const walk = (cmd: Command, parentPath: string): void => {
    const full = parentPath ? `${parentPath} ${cmd.name()}` : cmd.name();
    const longs = cmd.options.map((o) => o.long).filter((l): l is string => typeof l === "string");
    const hasJson = longs.includes("--json");
    const hasReport = longs.includes("--report");
    const isLeaf = (cmd as unknown as { _actionHandler?: unknown })._actionHandler != null;
    if (isLeaf) out.push({ path: full, hasJson, hasReport });
    for (const c of cmd.commands) walk(c, full);
  };
  for (const sub of program.commands) walk(sub, "");
  return out;
}

describe("output-spec coverage contract (ARV-120)", () => {
  const leaves = collectLeaves(buildProgram());
  const candidates = leaves.filter((l) => l.hasJson || l.hasReport);

  // AC#1 + AC#2: every --json / --report leaf is either in SPEC_REGISTRY
  // (migrated) or in LEGACY_ALLOW_LIST (pre-m-19, documented).
  test("every --json / --report leaf has an OutputSpec or a legacy allow-list entry", () => {
    const uncovered = candidates
      .filter((l) => !(l.path in SPEC_REGISTRY) && !(l.path in LEGACY_ALLOW_LIST))
      .map((l) => l.path);
    expect(
      uncovered,
      uncovered.length === 0
        ? ""
        : `New --json / --report leaves without OutputSpec declaration: ${uncovered.join(", ")}.\n` +
            `Either wire an OutputSpec (preferred — see src/core/output/types.ts) and add it to ` +
            `SPEC_REGISTRY in tests/contracts/output-spec-coverage.test.ts, or document the omission ` +
            `in LEGACY_ALLOW_LIST with a migration rationale.`,
    ).toEqual([]);
  });

  // Sanity: SPEC_REGISTRY entries don't overlap with LEGACY_ALLOW_LIST.
  // Catches accidental double-listing during migration.
  test("SPEC_REGISTRY and LEGACY_ALLOW_LIST do not overlap", () => {
    const overlap = Object.keys(SPEC_REGISTRY).filter((k) => k in LEGACY_ALLOW_LIST);
    expect(
      overlap,
      overlap.length === 0
        ? ""
        : `Commands listed in both SPEC_REGISTRY and LEGACY_ALLOW_LIST: ${overlap.join(", ")}. ` +
            `Once migrated, drop the legacy entry.`,
    ).toEqual([]);
  });

  // Sanity: every command named in SPEC_REGISTRY / LEGACY_ALLOW_LIST
  // actually exists in the program — guards against stale entries left
  // behind after a rename.
  test("SPEC_REGISTRY and LEGACY_ALLOW_LIST reference real leaves", () => {
    const known = new Set(candidates.map((c) => c.path));
    const stale = [...Object.keys(SPEC_REGISTRY), ...Object.keys(LEGACY_ALLOW_LIST)].filter(
      (p) => !known.has(p),
    );
    expect(
      stale,
      stale.length === 0
        ? ""
        : `Stale entries in SPEC_REGISTRY / LEGACY_ALLOW_LIST (command no longer exists or no longer accepts --json/--report): ${stale.join(", ")}.`,
    ).toEqual([]);
  });

  // AC#3: every envelope-wrapping format declares an envelopeSchemaFile,
  // and the schema file is on disk under docs/json-schema/. Drift in
  // either direction (schema renamed; spec stale) fails the test.
  test("every envelopeWrap format has an existing docs/json-schema file", () => {
    const problems: string[] = [];
    for (const [cmdPath, spec] of Object.entries(SPEC_REGISTRY)) {
      for (const [fmtName, policy] of Object.entries(spec.formats)) {
        if (policy.envelopeWrap !== true) continue;
        if (!policy.envelopeSchemaFile) {
          problems.push(`${cmdPath}/${fmtName}: envelopeWrap=true but envelopeSchemaFile missing`);
          continue;
        }
        const file = resolve(SCHEMA_DIR, policy.envelopeSchemaFile);
        if (!existsSync(file)) {
          problems.push(`${cmdPath}/${fmtName}: schema file not found — docs/json-schema/${policy.envelopeSchemaFile}`);
        }
      }
    }
    expect(
      problems,
      problems.length === 0
        ? ""
        : `envelope-format ↔ schema drift:\n  ${problems.join("\n  ")}`,
    ).toEqual([]);
  });
});

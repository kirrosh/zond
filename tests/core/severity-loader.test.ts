/**
 * ARV-283 Phase A: severity config loader (`loadSeverityConfig`) — disk-
 * side companion to `severity-calibration.test.ts` (pure unit tests).
 * Verifies file lookup, YAML parsing, validation surfacing, and the
 * workspace + per-API stack-merging semantics.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadSeverityConfig, SeverityConfigError } from "../../src/core/severity/loader.ts";

function makeTmpWs(): { root: string; cleanup: () => void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "zond-severity-loader-")));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("loadSeverityConfig", () => {
  let root: string;
  let cleanup: () => void;
  beforeEach(() => { ({ root, cleanup } = makeTmpWs()); });
  afterEach(() => { cleanup(); });

  it("returns empty merged config when no files exist", () => {
    const merged = loadSeverityConfig({ workspaceRoot: root });
    expect(merged.checks).toEqual({});
    expect(merged.suppressions).toEqual([]);
  });

  it("loads workspace-level .zond/severity.yaml", () => {
    mkdirSync(join(root, ".zond"));
    writeFileSync(
      join(root, ".zond", "severity.yaml"),
      "version: 1\nchecks:\n  foo:\n    severity: low\n",
      "utf-8",
    );
    const merged = loadSeverityConfig({ workspaceRoot: root });
    expect(merged.checks.foo?.severity).toBe("low");
  });

  it("layers per-API config on top of workspace (later wins on conflict)", () => {
    mkdirSync(join(root, ".zond"));
    writeFileSync(
      join(root, ".zond", "severity.yaml"),
      "version: 1\nchecks:\n  foo:\n    severity: low\n",
      "utf-8",
    );
    mkdirSync(join(root, "apis", "stripe"), { recursive: true });
    writeFileSync(
      join(root, "apis", "stripe", ".zond-severity.yaml"),
      "version: 1\nchecks:\n  foo:\n    severity: medium\n",
      "utf-8",
    );
    const merged = loadSeverityConfig({ workspaceRoot: root, api: "stripe" });
    expect(merged.checks.foo?.severity).toBe("medium");
  });

  it("unions suppressions across layers", () => {
    mkdirSync(join(root, ".zond"));
    writeFileSync(
      join(root, ".zond", "severity.yaml"),
      "version: 1\nsuppressions:\n  - check: a\n    when:\n      response.status: 500\n    reason: ws\n",
      "utf-8",
    );
    mkdirSync(join(root, "apis", "x"), { recursive: true });
    writeFileSync(
      join(root, "apis", "x", ".zond-severity.yaml"),
      "version: 1\nsuppressions:\n  - check: b\n    when:\n      response.status: 500\n    reason: api\n",
      "utf-8",
    );
    const merged = loadSeverityConfig({ workspaceRoot: root, api: "x" });
    expect(merged.suppressions).toHaveLength(2);
    expect(merged.suppressions.map((s) => s.check)).toContain("a");
    expect(merged.suppressions.map((s) => s.check)).toContain("b");
  });

  it("throws SeverityConfigError with file:keypath:message on invalid config", () => {
    mkdirSync(join(root, ".zond"));
    const path = join(root, ".zond", "severity.yaml");
    writeFileSync(path, "version: 2\n", "utf-8");
    try {
      loadSeverityConfig({ workspaceRoot: root });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SeverityConfigError);
      const e = err as SeverityConfigError;
      expect(e.errors).toHaveLength(1);
      expect(e.errors[0]!.source).toBe(path);
      expect(e.errors[0]!.keyPath).toBe("version");
    }
  });

  it("throws on YAML parse failure", () => {
    mkdirSync(join(root, ".zond"));
    const path = join(root, ".zond", "severity.yaml");
    writeFileSync(path, "version: 1\nchecks:\n  foo:\n    severity: [unterminated", "utf-8");
    expect(() => loadSeverityConfig({ workspaceRoot: root })).toThrow(SeverityConfigError);
  });

  it("ignores per-API file when api is undefined", () => {
    mkdirSync(join(root, "apis", "stripe"), { recursive: true });
    writeFileSync(
      join(root, "apis", "stripe", ".zond-severity.yaml"),
      "version: 1\nchecks:\n  foo:\n    severity: medium\n",
      "utf-8",
    );
    const merged = loadSeverityConfig({ workspaceRoot: root });
    expect(merged.checks).toEqual({});
  });
});

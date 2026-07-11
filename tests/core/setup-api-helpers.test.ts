/**
 * Unit tests for the spec-resolution helpers in src/core/setup-api.ts.
 * Covers the workspace-portable path semantics introduced when we moved
 * the spec from external paths into apis/<name>/spec.json.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveCollectionSpec,
  assertLocalSpec,
  parseEnvValues,
  SPEC_SNAPSHOT_FILENAME,
} from "../../src/core/setup-api.ts";

// ARV-422: re-registration must preserve a seeded .env.yaml. parseEnvValues
// reads the RAW values (no @secret: resolution) so `{...defaults, ...existing}`
// keeps hand-seeded ids and secret refs verbatim.
describe("setup-api / parseEnvValues (ARV-422)", () => {
  test("parses quoted and bare values, keeps non-empty", () => {
    const got = parseEnvValues(`base_url: "https://api.x/"\ncustomer: cus_123\nempty: ""\n`);
    expect(got.base_url).toBe("https://api.x/");
    expect(got.customer).toBe("cus_123");
    expect(got.empty).toBe("");
  });

  test("preserves @secret: refs literally (no resolution)", () => {
    expect(parseEnvValues(`auth_token: "@secret:auth_token"\n`).auth_token).toBe("@secret:auth_token");
  });

  test("merge keeps existing values over regenerated defaults, adds new keys", () => {
    const defaults = { base_url: "https://api.x/", customer: "", newvar: "" };
    const existing = parseEnvValues(`base_url: "https://api.x/"\ncustomer: cus_123\n`);
    const merged = { ...defaults, ...existing };
    expect(merged.customer).toBe("cus_123"); // seeded value survives
    expect(merged.newvar).toBe(""); // brand-new spec var gets its placeholder
  });

  test("skips comment and blank lines", () => {
    expect(parseEnvValues(`# a comment\n\ncustomer: cus_9\n`)).toEqual({ customer: "cus_9" });
  });
});

describe("setup-api / resolveCollectionSpec", () => {
  let workspace: string;
  let savedCwd: string;

  beforeEach(() => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-spec-helper-")));
    // mark workspace via zond.config.yml — hasMarker recognises it (cleanest).
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n", "utf-8");
    savedCwd = process.cwd();
    process.chdir(workspace);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  test("URL passes through unchanged", () => {
    expect(resolveCollectionSpec("https://example.com/openapi.json"))
      .toBe("https://example.com/openapi.json");
    expect(resolveCollectionSpec("http://localhost/openapi.json"))
      .toBe("http://localhost/openapi.json");
  });

  test("workspace-relative path resolves to absolute when the file exists", () => {
    const apiDir = join(workspace, "apis", "demo");
    mkdirSync(apiDir, { recursive: true });
    const specPath = join(apiDir, SPEC_SNAPSHOT_FILENAME);
    writeFileSync(specPath, "{}", "utf-8");

    const resolved = resolveCollectionSpec("apis/demo/spec.json");
    expect(resolved).toBe(specPath);
  });

  test("legacy absolute path that exists is returned as-is", () => {
    const external = join(workspace, "external-spec.json");
    writeFileSync(external, "{}", "utf-8");
    expect(resolveCollectionSpec(external)).toBe(external);
  });

  test("missing path throws with refresh-api hint", () => {
    expect(() => resolveCollectionSpec("apis/demo/spec.json"))
      .toThrow(/refresh-api/);
  });

  test("missing legacy absolute path also throws", () => {
    expect(() => resolveCollectionSpec("/totally/nonexistent/legacy.json"))
      .toThrow(/legacy or stale/);
  });
});

describe("setup-api / assertLocalSpec", () => {
  let workspace: string;
  let savedCwd: string;

  beforeEach(() => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-spec-strict-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n", "utf-8");
    savedCwd = process.cwd();
    process.chdir(workspace);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  test("rejects remote URL with refresh-api hint", () => {
    expect(() => assertLocalSpec("https://api.example.com/openapi.json", "demo"))
      .toThrow(/refresh-api demo/);
  });

  test("returns absolute path for an existing local snapshot", () => {
    const apiDir = join(workspace, "apis", "demo");
    mkdirSync(apiDir, { recursive: true });
    const specPath = join(apiDir, SPEC_SNAPSHOT_FILENAME);
    writeFileSync(specPath, "{}", "utf-8");

    expect(assertLocalSpec("apis/demo/spec.json", "demo")).toBe(specPath);
  });

  test("throws for missing local snapshot", () => {
    expect(() => assertLocalSpec("apis/demo/spec.json", "demo"))
      .toThrow(/Local spec missing for API 'demo'/);
  });
});

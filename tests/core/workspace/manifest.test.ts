import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  hasManifest,
  inferApiName,
  inspectEntries,
  loadManifest,
  recordGeneratedFile,
  recordGeneratedFiles,
  removeManifestEntries,
  selectEntries,
  sha256OfFile,
  toWorkspacePath,
  type ManifestEntry,
} from "../../../src/core/workspace/manifest.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zond-manifest-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeFile(rel: string, body: string): string {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf-8");
  return abs;
}

describe("manifest", () => {
  test("loadManifest returns empty when missing", () => {
    expect(hasManifest(root)).toBe(false);
    const m = loadManifest(root);
    expect(m.version).toBeGreaterThan(0);
    expect(m.generated).toEqual([]);
  });

  test("recordGeneratedFile appends and computes sha256", () => {
    const abs = writeFile("apis/sentry/.api-catalog.yaml", "# catalog\n");
    recordGeneratedFile(root, { path: abs, by: "zond add api", api: "sentry", category: "catalog" });

    const m = loadManifest(root);
    expect(m.generated).toHaveLength(1);
    expect(m.generated[0]!.path).toBe("apis/sentry/.api-catalog.yaml");
    expect(m.generated[0]!.sha256).toBe(sha256OfFile(abs)!);
    expect(m.generated[0]!.api).toBe("sentry");
    expect(m.generated[0]!.category).toBe("catalog");
  });

  test("re-recording the same path replaces the entry, not duplicates", () => {
    const abs = writeFile("apis/x/.api-catalog.yaml", "v1");
    recordGeneratedFile(root, { path: abs, by: "zond add api", api: "x" });
    writeFileSync(abs, "v2", "utf-8");
    recordGeneratedFile(root, { path: abs, by: "zond add api", api: "x" });

    const m = loadManifest(root);
    expect(m.generated).toHaveLength(1);
    expect(m.generated[0]!.sha256).toBe(sha256OfFile(abs)!);
  });

  test("inspectEntries flags modified vs delete vs missing", () => {
    const tracked = writeFile("apis/x/spec.json", "{}");
    const sha = sha256OfFile(tracked)!;
    const entries: ManifestEntry[] = [
      { path: "apis/x/spec.json", sha256: sha, by: "test", ts: "2026-01-01T00:00:00Z" },
      { path: "apis/x/touched.yaml", sha256: "deadbeef", by: "test", ts: "2026-01-01T00:00:00Z" },
      { path: "apis/x/missing.yaml", sha256: "abc", by: "test", ts: "2026-01-01T00:00:00Z" },
    ];
    writeFile("apis/x/touched.yaml", "edited");
    const items = inspectEntries(root, entries);
    expect(items[0]!.verdict).toBe("delete");
    expect(items[1]!.verdict).toBe("modified");
    expect(items[2]!.verdict).toBe("missing");
  });

  test("selectEntries filters by api/category/all (spec entries are never selected)", () => {
    recordGeneratedFiles(root, [
      { path: writeFile("apis/a/spec.json", "1"), by: "t", api: "a", category: "spec" },
      { path: writeFile("apis/a/probes/p1.yaml", "1"), by: "t", api: "a", category: "probes" },
      { path: writeFile("apis/a/.api-catalog.yaml", "1"), by: "t", api: "a", category: "catalog" },
      { path: writeFile("apis/b/spec.json", "1"), by: "t", api: "b", category: "spec" },
      { path: writeFile("apis/b/probes/p1.yaml", "1"), by: "t", api: "b", category: "probes" },
    ]);
    const m = loadManifest(root);
    // spec.json is source-of-truth — never returned (TASK-226).
    expect(selectEntries(m, { api: "a" })).toHaveLength(2);
    expect(selectEntries(m, { api: "b" })).toHaveLength(1);
    expect(selectEntries(m, { category: "probes" })).toHaveLength(2);
    expect(selectEntries(m, { all: true })).toHaveLength(3);
  });

  test("removeManifestEntries drops by relative path", () => {
    const abs = writeFile("apis/x/spec.json", "1");
    recordGeneratedFile(root, { path: abs, by: "t", api: "x" });
    expect(loadManifest(root).generated).toHaveLength(1);
    removeManifestEntries(root, [abs]);
    expect(loadManifest(root).generated).toHaveLength(0);
  });

  test("toWorkspacePath returns POSIX-relative path", () => {
    const abs = join(root, "apis", "x", "spec.json");
    expect(toWorkspacePath(root, abs)).toBe("apis/x/spec.json");
  });

  test("inferApiName extracts api from apis/<name>/...", () => {
    expect(inferApiName("apis/sentry/tests")).toBe("sentry");
    expect(inferApiName("/abs/path/apis/foo/probes/v")).toBe("foo");
    expect(inferApiName("other")).toBeUndefined();
  });

  test("manifest survives malformed json (returns empty)", () => {
    mkdirSync(join(root, ".zond"));
    writeFileSync(join(root, ".zond/manifest.json"), "{not json", "utf-8");
    const m = loadManifest(root);
    expect(m.generated).toEqual([]);
  });

  test("manifest file is created on first record", () => {
    expect(existsSync(join(root, ".zond/manifest.json"))).toBe(false);
    const abs = writeFile("apis/x/spec.json", "1");
    recordGeneratedFile(root, { path: abs, by: "t" });
    expect(existsSync(join(root, ".zond/manifest.json"))).toBe(true);
    const raw = JSON.parse(readFileSync(join(root, ".zond/manifest.json"), "utf-8"));
    expect(raw.version).toBe(1);
  });
});

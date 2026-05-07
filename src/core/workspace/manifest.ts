/**
 * `.zond/manifest.json` — auto-generated file tracking (TASK-156, m-9).
 *
 * Every command that writes files into the workspace appends an entry
 * here so `zond clean` can later remove only what zond produced, leaving
 * user edits intact (sha256 mismatch → manually-edited → skipped).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MANIFEST_VERSION = 1;
const MANIFEST_RELPATH = ".zond/manifest.json";

export type ManifestCategory =
  | "spec"
  | "catalog"
  | "resources"
  | "fixtures"
  | "env"
  | "tests"
  | "probes"
  | "other";

export interface ManifestEntry {
  /** Workspace-relative POSIX path. */
  path: string;
  /** sha256 of the file contents at write-time. */
  sha256: string;
  /** Command that emitted the file (e.g. "zond generate", "zond probe-validation --emit"). */
  by: string;
  /** ISO 8601 timestamp. */
  ts: string;
  /** API name when applicable (used by `zond clean --api <name>`). */
  api?: string;
  /** Logical category for `zond clean --probes` etc. */
  category?: ManifestCategory;
}

export interface Manifest {
  version: number;
  generated: ManifestEntry[];
}

function getManifestPath(workspaceRoot: string): string {
  return join(workspaceRoot, MANIFEST_RELPATH);
}

export function loadManifest(workspaceRoot: string): Manifest {
  const p = getManifestPath(workspaceRoot);
  if (!existsSync(p)) return { version: MANIFEST_VERSION, generated: [] };
  try {
    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.generated)) {
      return { version: MANIFEST_VERSION, generated: [] };
    }
    return {
      version: typeof parsed.version === "number" ? parsed.version : MANIFEST_VERSION,
      generated: parsed.generated as ManifestEntry[],
    };
  } catch {
    return { version: MANIFEST_VERSION, generated: [] };
  }
}

function saveManifest(workspaceRoot: string, manifest: Manifest): void {
  const p = getManifestPath(workspaceRoot);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

/** Workspace-relative POSIX path. */
export function toWorkspacePath(workspaceRoot: string, filePath: string): string {
  const abs = isAbsolute(filePath) ? filePath : resolve(filePath);
  let rel = relative(workspaceRoot, abs);
  if (sep === "\\") rel = rel.split(sep).join("/");
  return rel;
}

export function sha256OfFile(filePath: string): string | null {
  try {
    const buf = readFileSync(filePath);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

function sha256OfString(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface RecordInput {
  /** Absolute or workspace-relative path of the file just written. */
  path: string;
  by: string;
  api?: string;
  category?: ManifestCategory;
  /** Pre-computed sha256; if absent, the file is read from disk. */
  sha256?: string;
}

/**
 * Append (or replace) entries in the manifest. Existing entries with the
 * same `path` are replaced so re-running a generator updates the hash
 * instead of accumulating duplicates.
 */
export function recordGeneratedFiles(workspaceRoot: string, entries: RecordInput[]): void {
  if (entries.length === 0) return;
  const ts = new Date().toISOString();
  const accepted: ManifestEntry[] = [];

  for (const e of entries) {
    const abs = isAbsolute(e.path) ? e.path : resolve(workspaceRoot, e.path);
    const rel = toWorkspacePath(workspaceRoot, abs);
    // Refuse to record paths that escape the workspace — happens when tests
    // run setupApi from a tmp dir but findWorkspaceRoot walks up to the host
    // project root. Without this guard, a `../../../tmp/...` entry pollutes
    // the host workspace's manifest.
    if (rel.startsWith("..") || isAbsolute(rel)) continue;
    const sha = e.sha256 ?? sha256OfFile(abs);
    if (!sha) continue; // file vanished; skip
    accepted.push({
      path: rel,
      sha256: sha,
      by: e.by,
      ts,
      api: e.api,
      category: e.category,
    });
  }

  // Don't touch disk when nothing applied to this workspace — keeps tests
  // (which run from /tmp but inherit the host's workspace root) from
  // creating an empty `.zond/manifest.json` in the dev repo.
  if (accepted.length === 0) return;

  const manifest = loadManifest(workspaceRoot);
  const byPath = new Map<string, ManifestEntry>();
  for (const e of manifest.generated) byPath.set(e.path, e);
  for (const e of accepted) byPath.set(e.path, e);

  manifest.version = MANIFEST_VERSION;
  manifest.generated = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  saveManifest(workspaceRoot, manifest);
}

export function recordGeneratedFile(workspaceRoot: string, entry: RecordInput): void {
  recordGeneratedFiles(workspaceRoot, [entry]);
}

export interface CleanFilter {
  api?: string;
  category?: ManifestCategory;
  /** When true, include all entries regardless of api/category. */
  all?: boolean;
}

export function selectEntries(manifest: Manifest, filter: CleanFilter): ManifestEntry[] {
  const out: ManifestEntry[] = [];
  for (const e of manifest.generated) {
    if (filter.all) {
      out.push(e);
      continue;
    }
    if (filter.api) {
      const matchesApi = e.api === filter.api ||
        e.path.startsWith(`apis/${filter.api}/`);
      if (!matchesApi) continue;
    }
    if (filter.category && e.category !== filter.category) continue;
    out.push(e);
  }
  return out;
}

export type CleanVerdict = "delete" | "modified" | "missing";

export interface CleanItem {
  entry: ManifestEntry;
  absPath: string;
  verdict: CleanVerdict;
  /** Current sha256 if file exists. */
  currentSha256?: string;
}

export function inspectEntries(workspaceRoot: string, entries: ManifestEntry[]): CleanItem[] {
  const items: CleanItem[] = [];
  for (const entry of entries) {
    const abs = resolve(workspaceRoot, entry.path);
    if (!existsSync(abs)) {
      items.push({ entry, absPath: abs, verdict: "missing" });
      continue;
    }
    const cur = sha256OfFile(abs);
    if (cur && cur !== entry.sha256) {
      items.push({ entry, absPath: abs, verdict: "modified", currentSha256: cur });
    } else {
      items.push({ entry, absPath: abs, verdict: "delete", currentSha256: cur ?? undefined });
    }
  }
  return items;
}

/**
 * Drop entries from the manifest by absolute or workspace-relative path.
 */
export function removeManifestEntries(workspaceRoot: string, paths: string[]): void {
  if (paths.length === 0) return;
  const manifest = loadManifest(workspaceRoot);
  const drop = new Set(paths.map((p) => toWorkspacePath(workspaceRoot, p)));
  manifest.generated = manifest.generated.filter((e) => !drop.has(e.path));
  saveManifest(workspaceRoot, manifest);
}

/** True when the workspace has a manifest file. */
export function hasManifest(workspaceRoot: string): boolean {
  return existsSync(getManifestPath(workspaceRoot));
}

/**
 * Header comment prepended to every YAML/MD file zond writes, so a human
 * opening the file sees who wrote it and how to regenerate it. Pair with
 * `recordGeneratedFile` for the machine-readable audit trail.
 */
export function autoGenHeader(by: string, regenerate?: string): string {
  const lines = [
    `# Auto-generated by ${by}.`,
    `# ⚠️ Edits will be overwritten on regenerate. Drop from .zond/manifest.json (or rename) to keep changes.`,
  ];
  if (regenerate) lines.push(`# Regenerate: ${regenerate}`);
  return lines.join("\n") + "\n";
}

/**
 * Best-effort: derive the API name from a path like `apis/sentry/tests`.
 * Returns undefined for non-conventional layouts so manifest entries stay
 * un-tagged rather than mis-tagged.
 */
export function inferApiName(outputDir: string): string | undefined {
  const norm = outputDir.replace(/\\/g, "/");
  const m = norm.match(/(?:^|\/)apis\/([^/]+)(?:\/|$)/);
  return m?.[1];
}

/** Cheap sanity check used by zond doctor — true when path lives in workspace. */
function isWithinWorkspace(workspaceRoot: string, candidate: string): boolean {
  const abs = isAbsolute(candidate) ? candidate : resolve(workspaceRoot, candidate);
  try {
    statSync(abs);
  } catch {
    return false;
  }
  const rel = relative(workspaceRoot, abs);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

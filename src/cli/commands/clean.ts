/**
 * `zond clean` — remove auto-generated files tracked in `.zond/manifest.json`.
 *
 * Default mode is dry-run; `--force` is required to actually delete. Files
 * whose sha256 no longer matches the manifest entry are treated as
 * manually-edited and skipped (TASK-156, m-9).
 */

import { rmSync, rmdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findWorkspaceRoot } from "../../core/workspace/root.ts";
import {
  hasManifest,
  inspectEntries,
  loadManifest,
  removeManifestEntries,
  selectEntries,
  type CleanItem,
  type ManifestCategory,
} from "../../core/workspace/manifest.ts";
import type { Command } from "commander";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { printError, printSuccess } from "../output.ts";
import { globalJson } from "../resolve.ts";

export interface CleanOptions {
  api?: string;
  probes?: boolean;
  all?: boolean;
  force?: boolean;
  json?: boolean;
}

export async function cleanCommand(opts: CleanOptions): Promise<number> {
  const ws = findWorkspaceRoot();
  if (ws.fromFallback) {
    const m = "No workspace detected. Run `zond init` first.";
    if (opts.json) printJson(jsonError("clean", [m])); else printError(m);
    return 2;
  }

  if (!hasManifest(ws.root)) {
    const msg = `No .zond/manifest.json — nothing tracked yet. Run \`zond add api\`, \`zond generate\`, or a probe-* --emit first.`;
    if (opts.json) {
      printJson(jsonOk("clean", { dryRun: true, deleted: [], modified: [], missing: [], message: msg }));
    } else {
      console.log(msg);
    }
    return 0;
  }

  if (!opts.api && !opts.probes && !opts.all) {
    const m = "Specify a scope: --api <name>, --probes, or --all.";
    if (opts.json) printJson(jsonError("clean", [m])); else printError(m);
    return 2;
  }

  const manifest = loadManifest(ws.root);
  const category: ManifestCategory | undefined = opts.probes ? "probes" : undefined;
  const entries = selectEntries(manifest, {
    api: opts.api,
    category,
    all: opts.all && !opts.api && !opts.probes,
  });

  if (entries.length === 0) {
    const m = "No matching auto-generated files in manifest.";
    if (opts.json) {
      printJson(jsonOk("clean", { dryRun: true, deleted: [], modified: [], missing: [], message: m }));
    } else {
      console.log(m);
    }
    return 0;
  }

  const items = inspectEntries(ws.root, entries);
  const toDelete = items.filter((i) => i.verdict === "delete");
  const modified = items.filter((i) => i.verdict === "modified");
  const missing = items.filter((i) => i.verdict === "missing");

  const dryRun = !opts.force;

  if (!dryRun) {
    for (const item of toDelete) {
      try {
        rmSync(item.absPath, { force: true });
      } catch {
        // best-effort
      }
    }
    pruneEmptyDirs(ws.root, toDelete);
    const removedPaths = [...toDelete, ...missing].map((i) => i.entry.path);
    removeManifestEntries(ws.root, removedPaths);
  }

  if (opts.json) {
    printJson(jsonOk("clean", {
      dryRun,
      scope: { api: opts.api, probes: !!opts.probes, all: !!opts.all },
      deleted: toDelete.map(itemSummary),
      modified: modified.map(itemSummary),
      missing: missing.map(itemSummary),
    }));
    return 0;
  }

  const verb = dryRun ? "Would delete" : "Deleted";
  printSuccess(`${verb} ${toDelete.length} file(s); ${modified.length} skipped (manually edited); ${missing.length} already missing.`);
  if (toDelete.length > 0) {
    console.log("");
    console.log(`${verb}:`);
    for (const i of toDelete) console.log(`  - ${i.entry.path}`);
  }
  if (modified.length > 0) {
    console.log("");
    console.log("Skipped (manually edited, sha256 mismatch):");
    for (const i of modified) console.log(`  ! ${i.entry.path}`);
  }
  if (dryRun) {
    console.log("");
    console.log("Re-run with --force to actually delete.");
  }
  return 0;
}

function itemSummary(i: CleanItem) {
  return {
    path: i.entry.path,
    by: i.entry.by,
    ts: i.entry.ts,
    api: i.entry.api,
    category: i.entry.category,
    verdict: i.verdict,
  };
}

/**
 * After deleting tracked files, remove any directories that are now empty
 * and live inside the workspace. Best-effort: stops at first non-empty dir.
 */
function pruneEmptyDirs(workspaceRoot: string, items: CleanItem[]): void {
  const dirs = new Set<string>();
  for (const i of items) dirs.add(dirname(i.absPath));
  // Process deepest first.
  const sorted = [...dirs].sort((a, b) => b.length - a.length);
  for (const d of sorted) {
    let cur = d;
    while (cur.startsWith(workspaceRoot) && cur !== workspaceRoot) {
      if (!existsSync(cur)) {
        cur = dirname(cur);
        continue;
      }
      let entries: string[] = [];
      try {
        entries = readdirSync(cur);
      } catch {
        break;
      }
      if (entries.length > 0) break;
      try {
        rmdirSync(cur);
      } catch {
        break;
      }
      cur = dirname(cur);
    }
  }
  // Keep `resolve` reachable for type-only imports.
  void resolve;
}

export function registerClean(program: Command): void {
  program
    .command("clean")
    .description("Remove auto-generated files tracked in .zond/manifest.json (TASK-156, m-9)")
    .option("--api <name>", "Limit to a single API (apis/<name>/)")
    .option("--probes", "Limit to probe-suite files only")
    .option("--all", "Remove every tracked auto-generated file in the workspace")
    .option("--force", "Actually delete files (default is dry-run)")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await cleanCommand({
        api: opts.api,
        probes: opts.probes === true,
        all: opts.all === true,
        force: opts.force === true,
        json: globalJson(cmd),
      });
    });
}

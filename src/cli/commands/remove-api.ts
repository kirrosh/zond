/**
 * `zond remove api <name>` — unregister an API from the workspace.
 *
 * Mirrors `zond add api`. Removes the `collections` row, optionally the
 * associated `runs`/`results`, and (by default) the `apis/<name>/`
 * directory on disk. If the removed API was the active one
 * (`.zond/current-api`), the marker is cleared.
 *
 * Without `--purge`, runs that referenced the collection are detached
 * (`collection_id = NULL`) so historical run data survives the removal.
 * `--purge` deletes them outright. `--keep-files` leaves the directory
 * on disk and only drops the DB row, useful when the user wants to
 * snapshot the artifacts elsewhere first.
 */

import { existsSync, rmSync } from "node:fs";
import { relative, resolve } from "node:path";
import { getDb } from "../../db/schema.ts";
import {
  deleteCollection,
  findCollectionByNameOrId,
} from "../../db/queries.ts";
import { findWorkspaceRoot } from "../../core/workspace/root.ts";
import { clearCurrentApi, readCurrentApi } from "../../core/context/current.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { printError, printSuccess } from "../output.ts";

export interface RemoveApiOptions {
  api: string;
  purge?: boolean;
  keepFiles?: boolean;
  yes?: boolean;
  dbPath?: string;
  json?: boolean;
}

export interface RemoveApiResult {
  api: string;
  collectionId: number;
  removedDir: string | null;
  detachedRuns: number;
  deletedRuns: number;
  clearedCurrent: boolean;
}

export async function removeApiCommand(opts: RemoveApiOptions): Promise<number> {
  try {
    getDb(opts.dbPath);
  } catch (err) {
    const m = `DB unavailable: ${(err as Error).message}`;
    if (opts.json) printJson(jsonError("remove-api", [m])); else printError(m);
    return 2;
  }

  const collection = findCollectionByNameOrId(opts.api);
  if (!collection) {
    const m = `API '${opts.api}' not found.`;
    if (opts.json) printJson(jsonError("remove-api", [m])); else printError(m);
    return 2;
  }

  const db = getDb();
  const runsCount = (db
    .query("SELECT COUNT(*) AS c FROM runs WHERE collection_id = ?")
    .get(collection.id) as { c: number }).c;

  const workspaceRoot = findWorkspaceRoot().root;
  const dirAbs = collection.base_dir
    ? resolve(workspaceRoot, collection.base_dir)
    : null;
  const willRemoveDir = !opts.keepFiles && dirAbs !== null && existsSync(dirAbs);
  const dirRel = dirAbs ? relative(workspaceRoot, dirAbs).replace(/\\/g, "/") : null;

  if (!opts.yes && !opts.json) {
    const parts = [
      `Removing API '${collection.name}' (id=${collection.id})`,
      willRemoveDir ? `  • directory: ${dirRel}` : `  • directory: kept`,
      opts.purge
        ? `  • runs: ${runsCount} runs + their results will be DELETED`
        : `  • runs: ${runsCount} runs will be detached (collection_id=NULL)`,
    ];
    process.stderr.write(parts.join("\n") + "\nPass --yes to confirm.\n");
    return 1;
  }

  const detachedRuns = opts.purge ? 0 : runsCount;
  const deletedRuns = opts.purge ? runsCount : 0;
  deleteCollection(collection.id, opts.purge === true);

  let removedDir: string | null = null;
  if (willRemoveDir && dirAbs) {
    rmSync(dirAbs, { recursive: true, force: true });
    removedDir = relative(workspaceRoot, dirAbs).replace(/\\/g, "/");
  }

  let clearedCurrent = false;
  const current = readCurrentApi(workspaceRoot);
  if (current === collection.name) {
    clearedCurrent = clearCurrentApi(workspaceRoot);
  }

  const result: RemoveApiResult = {
    api: collection.name,
    collectionId: collection.id,
    removedDir,
    detachedRuns,
    deletedRuns,
    clearedCurrent,
  };

  if (opts.json) {
    printJson(jsonOk("remove-api", result));
  } else {
    printSuccess(`Removed API '${collection.name}' (id=${collection.id})`);
    if (removedDir) process.stdout.write(`  Directory: ${removedDir} (deleted)\n`);
    else if (opts.keepFiles) process.stdout.write(`  Directory: ${dirRel ?? "<unknown>"} (kept by --keep-files)\n`);
    if (opts.purge) process.stdout.write(`  Runs: ${deletedRuns} deleted (--purge)\n`);
    else if (detachedRuns > 0) process.stdout.write(`  Runs: ${detachedRuns} detached (collection_id=NULL)\n`);
    if (clearedCurrent) process.stdout.write(`  Cleared .zond/current-api marker (was '${collection.name}')\n`);
  }
  return 0;
}

import type { Command } from "commander";
import { globalJson } from "../resolve.ts";

export function registerRemove(program: Command): void {
  const remove = program
    .command("remove")
    .alias("rm")
    .description("Unregister objects from the workspace");
  remove
    .command("api <name>")
    .description("Unregister an API: drops collections row, removes apis/<name>/, optionally purges run history")
    .option("--purge", "Also delete the runs+results that referenced this API (default: detach to NULL)")
    .option("--keep-files", "Leave apis/<name>/ on disk; only remove the DB record")
    .option("--yes", "Skip the interactive confirmation prompt")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (name: string, opts, cmd: Command) => {
      const json = globalJson(cmd);
      process.exitCode = await removeApiCommand({
        api: name,
        purge: opts.purge === true,
        keepFiles: opts.keepFiles === true,
        yes: opts.yes === true || json,
        dbPath: typeof opts.db === "string" ? opts.db : undefined,
        json,
      });
    });
}

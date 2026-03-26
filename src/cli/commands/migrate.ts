import { readMeta, writeMeta } from "../../core/meta/meta-store.ts";
import { pendingMigrations } from "../../core/migrations/registry.ts";
import { applyMigrationsToDirectory } from "../../core/migrations/migrator.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { version as ZOND_VERSION } from "../../../package.json";

export interface MigrateOptions {
  testsDir: string;
  dryRun?: boolean;
  /** Override the version in metadata (useful for testing migrations) */
  fromVersion?: string;
  json?: boolean;
}

export async function migrateCommand(options: MigrateOptions): Promise<number> {
  try {
    const meta = await readMeta(options.testsDir);
    if (!meta) {
      const msg =
        "No .zond-meta.json found. Run `zond generate <spec> --output <dir>` first to initialize metadata.";
      if (options.json) {
        printJson(jsonError("migrate", [msg]));
      } else {
        printError(msg);
      }
      return 2;
    }

    const fromVersion = options.fromVersion ?? meta.zondVersion;
    const pending = pendingMigrations(fromVersion);

    if (pending.length === 0) {
      const msg = `No migrations needed (already at v${fromVersion}).`;
      if (options.json) {
        printJson(jsonOk("migrate", { migrationsApplied: [], filesChanged: 0, results: [] }, [msg]));
      } else {
        console.log(msg);
      }
      return 0;
    }

    if (!options.json) {
      const label = options.dryRun ? "[dry-run] " : "";
      console.log(`${label}Applying ${pending.length} migration(s) to ${options.testsDir}/\n`);
      console.log("  Pending migrations:");
      for (const m of pending) {
        console.log(`    v${m.toVersion}  ${m.description}`);
      }
      console.log("");
    }

    const results = await applyMigrationsToDirectory(options.testsDir, pending, options.dryRun ?? false);

    const filesChanged = results.filter((r) => r.changed).length;

    // Report results
    if (!options.json) {
      for (const r of results) {
        if (r.error) {
          printWarning(`${r.file}  — error: ${r.error}`);
        } else if (r.changed) {
          console.log(`  ${r.file}  — ${r.appliedMigrations.length} migration(s) applied`);
        } else {
          console.log(`  ${r.file}  — no changes needed`);
        }
      }

      if (options.dryRun) {
        console.log(`\nNo files written (dry-run). ${filesChanged} file(s) would be updated.`);
      } else {
        const label = options.dryRun ? "Would update" : "Updated";
        if (filesChanged > 0) {
          printSuccess(`\n${label} ${filesChanged} file(s). Metadata written.`);
        } else {
          console.log("\nNo files needed changes.");
        }
      }
    }

    // Update metadata version (only on real run)
    if (!options.dryRun && filesChanged >= 0) {
      const latestVersion = pending[pending.length - 1]?.toVersion ?? ZOND_VERSION;
      await writeMeta(options.testsDir, {
        ...meta,
        zondVersion: latestVersion,
        lastSyncedAt: new Date().toISOString(),
      });
    }

    if (options.json) {
      printJson(jsonOk("migrate", {
        migrationsApplied: pending.map((m) => m.toVersion),
        filesChanged,
        results,
      }));
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("migrate", [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}

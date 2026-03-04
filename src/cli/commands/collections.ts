import { getDb } from "../../db/schema.ts";
import { listCollections } from "../../db/queries.ts";
import { formatDuration } from "../../core/reporter/console.ts";

export function collectionsCommand(dbPath?: string): number {
  getDb(dbPath);
  const collections = listCollections();

  if (collections.length === 0) {
    console.log("No collections found.");
    console.log("Hint: use `zond generate --from <spec>` to create a collection automatically.");
    return 0;
  }

  // Print table header
  const header = [
    "ID".padEnd(5),
    "Name".padEnd(30),
    "Runs".padEnd(6),
    "Pass Rate".padEnd(11),
    "Last Run".padEnd(20),
  ].join(" ");

  console.log(header);
  console.log("-".repeat(header.length));

  for (const c of collections) {
    const passRate = c.total_runs > 0 ? `${c.pass_rate}%` : "-";
    const lastRun = c.last_run_at ?? "-";
    const row = [
      String(c.id).padEnd(5),
      c.name.slice(0, 30).padEnd(30),
      String(c.total_runs).padEnd(6),
      passRate.padEnd(11),
      lastRun.slice(0, 20).padEnd(20),
    ].join(" ");
    console.log(row);
  }

  return 0;
}
